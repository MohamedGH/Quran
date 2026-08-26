import React from "react";
import { useNavigate } from "react-router-dom";

// ─── QuranBook3DPage ─────────────────────────────────────────────────────────
// Architecture: single WebGL canvas for all rendering.
// Each page spread is drawn as a WebGL texture (parchment + text composited
// on an offscreen 2D canvas) then mapped through the curl shader.
// No separate 2D overlay — everything in one GL canvas.

const _MUSHAF_PAGES = 604;
const _API3D = "https://api.alquran.cloud/v1";

// ── Vertex shader ─────────────────────────────────────────────────────────────
const _VS3D = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying   vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = vec4(a_pos, 0., 1.); }`;

// ── Page spread fragment shader ───────────────────────────────────────────────
// Renders left+right page textures with:
//  • cylindrical curl with crease highlight + back-face tint
//  • spine groove + gold filament
//  • per-page AO shadow near spine
//  • stacked-pages fore-edge
const _PAGE_FS = `
precision highp float;
varying vec2 v_uv;

uniform sampler2D u_tex;     // current spread texture (both pages)
uniform sampler2D u_texNext; // next spread (shown on back of curling leaf)
uniform float u_curl;        // 0=flat … 1=fully turned
uniform float u_dir;         // +1 = right-page curls forward, -1 = left-page

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

// ── Spine ─────────────────────────────────────────────────────────────────────
vec4 spineColor(float t, float vy){
  vec3 base = mix(vec3(.055,.020,.004), vec3(.095,.038,.009), noise(vec2(t*8.,vy*30.))*.5);
  float gold = exp(-pow((t-.5)*4.8,2.));
  base = mix(base, vec3(.82,.60,.20), gold*.6);
  float gl2  = smoothstep(.007,0.,abs(t-.20)) + smoothstep(.007,0.,abs(t-.80));
  base = mix(base, vec3(.78,.55,.18), gl2*.75);
  base -= smoothstep(.78,1.,fract(vy*58.))*.05;
  float sv = 1.-smoothstep(.82,1.,abs(vy-.5)*2.);
  base *= mix(.55,1.,sv);
  return vec4(base,1.);
}

// ── Cylindrical curl ──────────────────────────────────────────────────────────
void curl(
  in  vec2  pageUV,  // 0..1 within this half-page
  in  float c,       // curl progress 0..1
  in  bool  right,   // is this the right page?
  out vec2  mapped,  // remapped UV into the page texture half
  out float shade,   // darkening factor
  out bool  isBack,  // are we on the back face?
  out float crease   // crease highlight (0..1)
){
  mapped = pageUV; shade = 1.; isBack = false; crease = 0.;
  if(c < .001) return;

  bool curling = (u_dir > 0.) == right;
  if(!curling) return;

  float foldX = u_dir > 0. ? (1. - c) : c;
  float x     = u_dir > 0. ? pageUV.x : (1. - pageUV.x);
  float d     = x - foldX;
  float R     = max(.06, .55 * (1. - c * .65));

  crease = exp(-abs(d) * 180.) * c;

  if(d > 0.){
    // back face
    float ang   = min(d / (R * 3.14159), 1.);
    float flipX = foldX - sin(ang * 3.14159) * R * .55;
    float flipY = pageUV.y + (cos(ang * 3.14159) - 1.) * R * .07;
    mapped  = u_dir > 0. ? vec2(flipX, flipY) : vec2(1.-flipX, flipY);
    mapped  = clamp(mapped, 0., 1.);
    shade   = (.55 + .30 * (1.-c)) * cos(ang * 3.14159 * .4);
    isBack  = true;
  } else {
    // front face bulge
    float t2 = clamp((-d)/(.4*(1.-foldX)+.01),0.,1.);
    float by = sin(t2*3.14159)*c*.035;
    float bx = sin(t2*3.14159)*c*.010;
    mapped = u_dir > 0.
      ? vec2(pageUV.x-bx, pageUV.y+by*(pageUV.y-.5))
      : vec2(pageUV.x+bx, pageUV.y+by*(pageUV.y-.5));
    mapped = clamp(mapped, 0., 1.);
    shade  = .80 + .20*smoothstep(0.,.20,-d);
  }
}

// ── Fore-edge (stacked pages) ─────────────────────────────────────────────────
vec3 foreEdge(vec2 puv, vec3 col, bool right){
  float e = right ? smoothstep(.93,1.,puv.x) : smoothstep(.07,0.,puv.x);
  vec3 edge = vec3(.76,.68,.50);
  col = mix(col, edge, e * .55);
  float lines = fract(puv.y * 140.);
  col -= e * smoothstep(.65,1.,lines) * .045;
  return col;
}

void main(){
  bool  right  = v_uv.x > .5;
  float spW    = .014;
  float sx     = abs(v_uv.x - .5);

  // ── Spine ──────────────────────────────────────────────────────────────────
  if(sx < spW){
    float t = (v_uv.x - (.5-spW)) / (spW*2.);
    gl_FragColor = spineColor(t, v_uv.y);
    return;
  }

  // ── Page UV (0..1 within this half) ────────────────────────────────────────
  vec2 pageUV = right ? vec2((v_uv.x-.5)*2., v_uv.y)
                      : vec2(v_uv.x*2.,       v_uv.y);

  vec2  mapped; float shade; bool isBack; float crease;
  curl(pageUV, u_curl, right, mapped, shade, isBack, crease);

  // ── Sample texture ─────────────────────────────────────────────────────────
  // texture layout: left-half = left page, right-half = right page
  vec2 texUV = right ? vec2(.5 + mapped.x*.5, mapped.y)
                     : vec2(mapped.x*.5,       mapped.y);

  vec4 col;
  bool curling2 = (u_dir > 0.) == right;
  if(isBack && curling2 && u_curl > .01){
    // back face shows next spread
    vec2 nextUV = right ? vec2(.5 + mapped.x*.5, mapped.y)
                        : vec2(mapped.x*.5,       mapped.y);
    col = texture2D(u_texNext, nextUV);
  } else {
    col = texture2D(u_tex, texUV);
  }

  // ── Spine AO ───────────────────────────────────────────────────────────────
  float ao = right ? 1.-.44*exp(-pageUV.x*10.)
                   : 1.-.44*exp(-(1.-pageUV.x)*10.);
  col.rgb *= ao;

  // ── Fore-edge ─────────────────────────────────────────────────────────────
  col.rgb = foreEdge(pageUV, col.rgb, right);

  // ── Back face tint ────────────────────────────────────────────────────────
  if(isBack){
    col.rgb = mix(col.rgb * .70, vec3(.86,.76,.58), .15);
  }

  // ── Curl shade ────────────────────────────────────────────────────────────
  col.rgb *= shade;

  // ── Crease highlight ──────────────────────────────────────────────────────
  col.rgb += vec3(.98,.90,.72) * crease * .65;

  // ── Fold shadow on unturned pages ────────────────────────────────────────
  if(u_curl > .01){
    bool curling3 = (u_dir > 0.) == right;
    if(!isBack){
      float foldX2 = u_dir > 0. ? (1.-u_curl) : u_curl;
      float fx = u_dir > 0. ? pageUV.x : (1.-pageUV.x);
      col.rgb -= .32 * u_curl * exp(-abs(fx-foldX2)*24.) * (1.-float(isBack));
    }
  }

  gl_FragColor = vec4(clamp(col.rgb,0.,1.), 1.);
}`;

// ── Cover shader ──────────────────────────────────────────────────────────────
const _CVR_FS = `
precision highp float;
varying vec2 v_uv;
attribute vec2 a_uv;
uniform float u_time;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<7;i++){v+=a*noise(p);p*=2.1;a*=.48;}return v;}
vec3 gold(float t){ return mix(vec3(.66,.42,.08),vec3(.96,.80,.34),t); }

float rosette(vec2 c, float r, float petals, float t){
  float a=atan(c.y,c.x);
  float petal=.5+.5*cos(petals*a+t);
  return smoothstep(r*.85,r*.05, length(c)-petal*r*.48);
}

void main(){
  float n=fbm(v_uv*7.)*.2+fbm(v_uv*23.+3.)*.08;
  vec3 col=mix(vec3(.040,.015,.003),vec3(.110,.046,.011),n);
  vec2 c=v_uv-.5; float r=length(c),a=atan(c.y,c.x);

  // rings
  for(int k=0;k<5;k++){
    float rk=.40-float(k)*.055; float w=.007-.001*float(k);
    float ring=smoothstep(w*.5,0.,abs(r-rk));
    float sh=.65+.35*sin(float(k)*1.4+u_time*.7+a*4.);
    col=mix(col,gold(sh),ring*(.92-.15*float(k)));
  }

  // inner field
  float inner=smoothstep(.27,.22,r);
  vec3 fillC=mix(vec3(.07,.028,.006),vec3(.13,.055,.014),fbm(c*15.+u_time*.03)*.5);
  float tr=max(
    smoothstep(.035,.0,abs(sin(c.x*26.+u_time*.08)*cos(c.y*26.-.08*u_time)*.4)),
    smoothstep(.035,.0,abs(sin((c.x+c.y)*18.+u_time*.06)*.35))
  )*inner;
  fillC=mix(fillC,gold(.55+.4*sin(r*28.-u_time*1.1+a*3.))*.72,tr);
  col=mix(col,fillC,inner);

  // rosettes
  col=mix(col,gold(.55+.4*sin(u_time*1.4+r*18.)),rosette(c,.20,8.,u_time*.22)*.88);
  col=mix(col,gold(.75+.2*sin(u_time*1.8)),rosette(c,.10,6.,-u_time*.30)*.92);
  col=mix(col,vec3(1.,.94,.62),smoothstep(.020,.0,r));

  // 8-point star
  float star=pow(abs(sin(a*4.+u_time*.18)),3.5);
  col=mix(col,gold(.6+.35*star),star*(1.-smoothstep(.26,.36,r))*smoothstep(.07,.26,r)*.65);

  // corner ornaments
  vec2 co=abs(v_uv-.5)*2.;
  float cscroll=smoothstep(.60,.64,max(co.x,co.y))-smoothstep(.72,.76,max(co.x,co.y));
  col=mix(col,gold(.62+.25*sin(u_time+co.x*4.)),cscroll*.70);
  float cd=(1.-smoothstep(.0,.14,length(co-.82)))*smoothstep(.055,.0,abs(co.x-co.y));
  col=mix(col,gold(.72+.2*sin(u_time*.9)),cd*.88);

  // borders
  vec2 bd=min(v_uv,1.-v_uv);
  float b1=smoothstep(0.,.006,min(bd.x,bd.y))-smoothstep(.006,.014,min(bd.x,bd.y));
  float b2=smoothstep(.018,.022,min(bd.x,bd.y))-smoothstep(.022,.028,min(bd.x,bd.y));
  float b3=smoothstep(.033,.036,min(bd.x,bd.y))-smoothstep(.036,.042,min(bd.x,bd.y));
  float bs=.5+.5*sin(u_time*.5+(v_uv.x+v_uv.y)*7.);
  col=mix(col,gold(.58+.32*bs),b1*.92+b2*.72+b3*.55);

  // vignette
  vec2 dv=v_uv*(1.-v_uv);
  col*=mix(.35,1.,pow(dv.x*dv.y*18.,.27));

  col+=vec3(.92,.80,.44)*exp(-r*r*5.5)*(.11+.05*sin(u_time*1.8));
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

// ── GL helpers ────────────────────────────────────────────────────────────────
function _csh(gl,t,src){
  const s=gl.createShader(t);
  gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}
function _cprog(gl,vs,fs){
  const p=gl.createProgram();
  gl.attachShader(p,_csh(gl,gl.VERTEX_SHADER,vs));
  gl.attachShader(p,_csh(gl,gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p); return p;
}
function _makeTex(gl){
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  // init with 1x1 blank
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([245,235,200,255]));
  return t;
}
function _uploadTex(gl,tex,canvas){
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
}

// ── Offscreen spread canvas renderer ─────────────────────────────────────────
// Draws parchment background + ayat text for both pages side by side
function _renderSpread(leftAyahs, leftPn, rightAyahs, rightPn, W, H){
  const cvs=document.createElement("canvas"); cvs.width=W; cvs.height=H;
  const ctx=cvs.getContext("2d");

  const hw=W/2;

  // ── Parchment background ──────────────────────────────────────────────────
  // We draw it via gradient + noise simulation on 2D canvas
  for(let side=0;side<2;side++){
    const x0=side===0?0:hw;
    ctx.save();
    // base warm ivory
    const g=ctx.createLinearGradient(x0,0,x0+hw,H);
    g.addColorStop(0,  "#fdf8ea");
    g.addColorStop(.4, "#faf2d8");
    g.addColorStop(1,  "#f4e8c0");
    ctx.fillStyle=g;
    ctx.fillRect(x0,0,hw,H);

    // subtle grain via tiny dots (fast approximation)
    ctx.globalAlpha=.055;
    ctx.fillStyle="#8b6030";
    // draw a grid of semi-random dots for grain texture
    const step=3;
    for(let yy=0;yy<H;yy+=step){
      for(let xx=0;xx<hw;xx+=step){
        const v=Math.sin(xx*.71+yy*.53)*Math.cos(xx*.37-yy*.81)*.5+.5;
        if(v>.62){ ctx.fillRect(x0+xx,yy,1,1); }
      }
    }
    // laid lines
    ctx.globalAlpha=.04;
    ctx.fillStyle="#7a5520";
    for(let yy=0;yy<H;yy+=Math.round(H/42)){
      ctx.fillRect(x0,yy,hw,1);
    }
    ctx.globalAlpha=1;
    ctx.restore();

    // edge yellowing
    const ew=ctx.createLinearGradient(x0,0,x0+12,0);
    ew.addColorStop(0,"rgba(140,100,40,.22)"); ew.addColorStop(1,"rgba(140,100,40,0)");
    ctx.fillStyle=ew; ctx.fillRect(x0,0,18,H);
    const ew2=side===0
      ? ctx.createLinearGradient(x0+hw-12,0,x0+hw,0)
      : ctx.createLinearGradient(x0+hw-12,0,x0+hw,0);
    ew2.addColorStop(0,"rgba(140,100,40,0)"); ew2.addColorStop(1,"rgba(140,100,40,.22)");
    ctx.fillStyle=ew2; ctx.fillRect(x0+hw-18,0,18,H);
    const ewt=ctx.createLinearGradient(0,0,0,12);
    ewt.addColorStop(0,"rgba(140,100,40,.18)"); ewt.addColorStop(1,"rgba(140,100,40,0)");
    ctx.fillStyle=ewt; ctx.fillRect(x0,0,hw,14);
    const ewb=ctx.createLinearGradient(0,H-12,0,H);
    ewb.addColorStop(0,"rgba(140,100,40,0)"); ewb.addColorStop(1,"rgba(140,100,40,.18)");
    ctx.fillStyle=ewb; ctx.fillRect(x0,H-14,hw,14);
  }

  // ── Double border on each page ────────────────────────────────────────────
  const gold1="rgba(160,105,22,.55)", gold2="rgba(120,78,15,.35)";
  [[0,hw],[hw,hw]].forEach(([x0,w2])=>{
    const pm=w2*.044, pm2=w2*.060;
    ctx.strokeStyle=gold1; ctx.lineWidth=.9;
    ctx.strokeRect(x0+pm,H*.044,w2-pm*2,H*(1-.088));
    ctx.strokeStyle=gold2; ctx.lineWidth=.65;
    ctx.strokeRect(x0+pm2,H*.060,w2-pm2*2,H*(1-.12));
  });

  // ── Text: right page (odd) on right half, left page (even) on left half ──
  _drawPageText(ctx, rightAyahs, rightPn, hw, 0, hw, H);  // right half
  _drawPageText(ctx, leftAyahs,  leftPn,  0,  0, hw, H);  // left half

  return cvs;
}

function _drawPageText(ctx, ayahs, pn, x0, y0, w, h){
  if(!ayahs||!ayahs.length) return;

  const PAD  = Math.max(w*.078, 9);
  const PADt = Math.max(h*.065, 7);
  const BOT  = h - Math.max(h*.055, 6);
  const TW   = w - PAD*2;

  // Font — scales to available space, clamped for legibility
  const fs  = Math.max(Math.min(h/18.5, w/21, 17), 10);
  const lh  = fs * 1.52;
  const hfs = Math.max(fs*.56, 8);
  const bfs = Math.max(fs*.98, 11);

  // Top ornament rule
  ctx.save();
  ctx.strokeStyle="rgba(139,90,20,.30)"; ctx.lineWidth=.8;
  ctx.beginPath(); ctx.moveTo(x0+PAD*.85,y0+PADt-4); ctx.lineTo(x0+w-PAD*.85,y0+PADt-4); ctx.stroke();
  ctx.restore();

  let y=y0+PADt;

  // Group by surah
  const groups=[];
  (ayahs||[]).forEach(a=>{
    const last=groups[groups.length-1];
    if(!last||last.sn!==a.surah.number)
      groups.push({sn:a.surah.number,name:a.surah.name,eng:a.surah.englishName,ayahs:[]});
    groups[groups.length-1].ayahs.push(a);
  });

  for(const g of groups){
    if(g.ayahs[0]?.numberInSurah===1){
      y+=lh*.22;
      // header band
      ctx.save();
      const grd=ctx.createLinearGradient(x0+PAD,0,x0+w-PAD,0);
      grd.addColorStop(0,"rgba(139,90,20,.0)");
      grd.addColorStop(.3,"rgba(139,90,20,.09)");
      grd.addColorStop(.7,"rgba(139,90,20,.09)");
      grd.addColorStop(1,"rgba(139,90,20,.0)");
      ctx.fillStyle=grd;
      ctx.fillRect(x0+PAD*.7,y,w-PAD*1.4,lh*.92);

      ctx.strokeStyle="rgba(139,90,20,.32)"; ctx.lineWidth=.7;
      ctx.beginPath(); ctx.moveTo(x0+PAD*.75,y); ctx.lineTo(x0+w-PAD*.75,y); ctx.stroke();

      // English name left
      ctx.font=`italic ${hfs}px Georgia,serif`;
      ctx.fillStyle="rgba(65,35,5,.80)";
      ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.direction="ltr";
      ctx.fillText(g.eng.toUpperCase(), x0+PAD*.85, y+lh*.46);

      // Arabic name right
      ctx.font=`${Math.max(hfs*1.3,10)}px 'Amiri Quran','Scheherazade New',serif`;
      ctx.fillStyle="rgba(75,40,6,.82)";
      ctx.textAlign="right"; ctx.textBaseline="middle"; ctx.direction="rtl";
      ctx.fillText(g.name, x0+w-PAD*.85, y+lh*.46);

      y+=lh*.92;
      ctx.strokeStyle="rgba(139,90,20,.32)"; ctx.lineWidth=.7;
      ctx.beginPath(); ctx.moveTo(x0+PAD*.75,y); ctx.lineTo(x0+w-PAD*.75,y); ctx.stroke();
      ctx.restore();
      y+=lh*.22;

      // Basmala
      if(g.sn!==9 && y+bfs*1.5<y0+BOT){
        ctx.save();
        ctx.font=`${bfs}px 'Amiri Quran','Scheherazade New',serif`;
        ctx.fillStyle="rgba(24,10,2,.87)";
        ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.direction="rtl";
        ctx.fillText("\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u0651\u064e\u0647\u0650 \u0671\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0671\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650",
          x0+w/2, y+bfs*.55);
        ctx.restore();
        y+=lh*1.0;
      }
    }

    // Word-wrap ayahs
    ctx.font=`${fs}px 'Amiri Quran','Scheherazade New',serif`;
    const lines=[];
    let cur="";
    for(const a of g.ayahs){
      const words=a.text.split(" ");
      words.forEach((wd,wi)=>{
        const token = wi===words.length-1 ? wd+" ﴿"+a.numberInSurah+"﴾" : wd;
        const test  = cur ? cur+" "+token : token;
        ctx.font=`${fs}px 'Amiri Quran','Scheherazade New',serif`;
        if(ctx.measureText(test).width>TW && cur){ lines.push(cur); cur=token; }
        else cur=test;
      });
    }
    if(cur) lines.push(cur);

    ctx.save();
    ctx.font=`${fs}px 'Amiri Quran','Scheherazade New',serif`;
    ctx.fillStyle="rgba(18,7,2,.91)";
    ctx.direction="rtl"; ctx.textAlign="right"; ctx.textBaseline="alphabetic";
    for(const ln of lines){
      if(y+lh>y0+BOT) break;
      ctx.fillText(ln, x0+w-PAD, y+lh);
      y+=lh;
    }
    ctx.restore();
    y+=lh*.12;
  }

  // Page number + ornament
  const pnfs=Math.max(h*.027,7);
  ctx.save();
  ctx.strokeStyle="rgba(139,90,20,.26)"; ctx.lineWidth=.7;
  ctx.beginPath();
  ctx.moveTo(x0+PAD*.85,y0+BOT+3); ctx.lineTo(x0+w-PAD*.85,y0+BOT+3);
  ctx.stroke();

  const oy=y0+BOT+3+pnfs*1.1;
  const dd=pnfs*.38;
  ctx.fillStyle="rgba(120,78,18,.36)";
  [[x0+w/2-dd*5.5,oy],[x0+w/2+dd*5.5,oy]].forEach(([px2,py2])=>{
    ctx.beginPath();
    ctx.moveTo(px2,py2-dd*.65); ctx.lineTo(px2+dd*.65,py2);
    ctx.lineTo(px2,py2+dd*.65); ctx.lineTo(px2-dd*.65,py2);
    ctx.closePath(); ctx.fill();
  });

  ctx.font=`${pnfs}px 'Cinzel',Georgia,serif`;
  ctx.fillStyle="rgba(108,68,16,.46)";
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(String(pn), x0+w/2, oy);
  ctx.restore();
}

// ── Main component ────────────────────────────────────────────────────────────
export default function QuranBook3DPage({ surahs = [] }) {
  const navigate = useNavigate();

  const cvs3 = React.useRef(null);  // single WebGL canvas
  const raf3 = React.useRef(null);
  const gl3  = React.useRef(null);
  const glState = React.useRef({
    pageProg: null, coverProg: null,
    buf: null, uvBuf: null,
    texCur: null, texNext: null,
  });

  const pd  = React.useRef({});    // pageNum → ayahs[] (null=loading)
  const tx0 = React.useRef(0);

  const SR = React.useRef({
    curl: 0, targetCurl: 0, dir: 1,
    spread: 0,
    flipping: false,
    time: 0,
    phase: "cover",   // "cover"|"open"
    texDirty: true,   // need to re-upload textures
  });

  const [sp,    setSp]    = React.useState(0);
  const [ph,    setPh]    = React.useState("cover");
  const [smenu, setSmenu] = React.useState(false);
  const [bm,    setBm]    = React.useState(()=>parseInt(localStorage.getItem("q3d_bm")||"0")||0);
  const [sz,    setSz]    = React.useState({w:860,h:522});
  const [ready, setReady] = React.useState(false);

  // Responsive size
  React.useEffect(()=>{
    const u=()=>{
      const vw=window.innerWidth, vh=window.innerHeight;
      const w=Math.min((vw-14)*.97, (vh-85)*1.63, 980);
      setSz({w:Math.round(w), h:Math.round(w/1.63)});
    };
    u(); window.addEventListener("resize",u);
    return()=>window.removeEventListener("resize",u);
  },[]);

  // ── Build and upload spread textures to WebGL ──────────────────────────────
  const uploadSpreadTex = React.useCallback((spread, which="cur")=>{
    const gl=gl3.current; const gls=glState.current;
    if(!gl||spread===0) return;
    const rp=2*spread-1, lp=Math.min(2*spread,_MUSHAF_PAGES);
    const rd=pd.current[rp], ld=pd.current[lp];
    if(!rd||!ld) return;  // not loaded yet
    const cvs=_renderSpread(ld, lp, rd, rp, sz.w, sz.h);
    const tex=which==="cur"?gls.texCur:gls.texNext;
    _uploadTex(gl,tex,cvs);
  },[sz.w, sz.h]);

  // ── Prefetch ──────────────────────────────────────────────────────────────
  const prefetch=React.useCallback(async(spread, onReady)=>{
    if(spread===0) return;
    const pages=[
      2*spread-1, 2*spread,
      2*spread+1, 2*spread+2,
      2*spread-3, 2*spread-2,
    ].filter(p=>p>=1&&p<=_MUSHAF_PAGES);

    const crit=[2*spread-1,2*spread].filter(p=>p>=1&&p<=_MUSHAF_PAGES);

    // load critical first
    await Promise.all(crit.map(async p=>{
      if(pd.current[p]!==undefined) return;
      pd.current[p]=null;
      try{
        const d=await fetch(`${_API3D}/page/${p}/quran-uthmani`).then(r=>r.json()).then(r=>r.data?.ayahs||[]);
        pd.current[p]=d;
      }catch{ pd.current[p]=[]; }
    }));

    if(onReady) onReady();

    // load rest in background
    for(const p of pages){
      if(pd.current[p]!==undefined) continue;
      pd.current[p]=null;
      try{
        const d=await fetch(`${_API3D}/page/${p}/quran-uthmani`).then(r=>r.json()).then(r=>r.data?.ayahs||[]);
        pd.current[p]=d;
      }catch{ pd.current[p]=[]; }
    }
  },[]);

  // ── WebGL init ────────────────────────────────────────────────────────────
  React.useEffect(()=>{
    const cvs=cvs3.current; if(!cvs)return;
    const gl=cvs.getContext("webgl",{antialias:true,alpha:false});
    if(!gl){console.error("WebGL not available");return;}
    gl3.current=gl;

    const gls=glState.current;
    gls.pageProg  = _cprog(gl,_VS3D,_PAGE_FS);
    gls.coverProg = _cprog(gl,_VS3D,_CVR_FS);

    // Full-screen quad
    const verts=new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]);
    const uvs  =new Float32Array([ 0, 1,  1, 1,  0,0,  1, 1, 1,0,  0,0]);
    gls.buf   = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,gls.buf);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);
    gls.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,gls.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER,uvs,gl.STATIC_DRAW);

    gls.texCur  = _makeTex(gl);
    gls.texNext = _makeTex(gl);

    let lastSp=-1, lastW=0, lastH=0;

    const draw=(ts)=>{
      const s=SR.current;
      s.time=ts*.001;

      // smooth curl
      const diff=s.targetCurl-s.curl;
      s.curl+=diff*(diff>0?.15:.18);
      if(Math.abs(diff)<.003){
        s.curl=s.targetCurl;
        if(s.targetCurl===1&&s.flipping){
          s.flipping=false; s.curl=0; s.targetCurl=0;
          s.spread+=s.dir>0?1:-1;
          s.spread=Math.max(1,Math.min(302,s.spread));
          s.texDirty=true;
          setSp(s.spread);
          setReady(false);
          prefetch(s.spread,()=>{
            uploadSpreadTex(s.spread,"cur");
            prefetch(s.spread+1,()=>uploadSpreadTex(s.spread+1,"next"));
            prefetch(s.spread-1,()=>uploadSpreadTex(s.spread-1,"next"));
            setReady(true);
          });
        }
      }

      // re-upload textures when spread changed or canvas resized
      if(s.phase==="open" && (s.spread!==lastSp||sz.w!==lastW||sz.h!==lastH)){
        lastSp=s.spread; lastW=sz.w; lastH=sz.h;
        uploadSpreadTex(s.spread,"cur");
      }

      gl.viewport(0,0,cvs.width,cvs.height);
      gl.clearColor(.028,.012,.003,1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const usePageProg = s.phase==="open";
      const prog = usePageProg ? gls.pageProg : gls.coverProg;
      gl.useProgram(prog);

      // bind vertex pos
      const aPos=gl.getAttribLocation(prog,"a_pos");
      gl.bindBuffer(gl.ARRAY_BUFFER,gls.buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);

      // bind uv (cover shader also has varying v_uv via a_pos*.5+.5, but page shader uses a_uv)
      const aUv=gl.getAttribLocation(prog,"a_uv");
      if(aUv>=0){
        gl.bindBuffer(gl.ARRAY_BUFFER,gls.uvBuf);
        gl.enableVertexAttribArray(aUv);
        gl.vertexAttribPointer(aUv,2,gl.FLOAT,false,0,0);
      }

      gl.uniform1f(gl.getUniformLocation(prog,"u_time"),s.time);

      if(usePageProg){
        gl.uniform1f(gl.getUniformLocation(prog,"u_curl"),s.curl);
        gl.uniform1f(gl.getUniformLocation(prog,"u_dir"),s.dir);

        // texCur → unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,gls.texCur);
        gl.uniform1i(gl.getUniformLocation(prog,"u_tex"),0);

        // texNext → unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D,gls.texNext);
        gl.uniform1i(gl.getUniformLocation(prog,"u_texNext"),1);
      }

      gl.drawArrays(gl.TRIANGLES,0,6);
      raf3.current=requestAnimationFrame(draw);
    };
    raf3.current=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(raf3.current);
  },[]); // eslint-disable-line

  // Resize canvas
  React.useEffect(()=>{
    const c=cvs3.current; if(!c)return;
    c.width=sz.w; c.height=sz.h;
    if(SR.current.phase==="open") uploadSpreadTex(SR.current.spread,"cur");
  },[sz,uploadSpreadTex]);

  // ── Open book ─────────────────────────────────────────────────────────────
  const openBook=React.useCallback(()=>{
    const s=SR.current; if(s.phase!=="cover")return;
    s.spread=1; s.phase="open"; setPh("open"); setSp(1); setReady(false);
    prefetch(1,()=>{
      uploadSpreadTex(1,"cur");
      prefetch(2,()=>uploadSpreadTex(2,"next"));
      setReady(true);
    });
  },[prefetch,uploadSpreadTex]);

  // ── Flip ──────────────────────────────────────────────────────────────────
  const startFlip=React.useCallback((dir)=>{
    const s=SR.current;
    if(s.flipping||s.phase!=="open") return;
    if(dir>0&&2*(s.spread+1)-1>_MUSHAF_PAGES) return;
    if(dir<0&&s.spread<=1) return;

    const next=s.spread+dir;
    const doFlip=()=>{
      // upload next spread to texNext before flipping
      uploadSpreadTex(next,"next");
      s.flipping=true; s.dir=dir; s.curl=0; s.targetCurl=1;
    };

    // ensure next spread is loaded
    const np=[2*next-1,2*next].filter(p=>p>=1&&p<=_MUSHAF_PAGES);
    const missing=np.filter(p=>pd.current[p]===undefined);
    if(missing.length===0){
      doFlip();
    } else {
      Promise.all(missing.map(async p=>{
        if(pd.current[p]!==undefined)return;
        pd.current[p]=null;
        try{
          const d=await fetch(`${_API3D}/page/${p}/quran-uthmani`).then(r=>r.json()).then(r=>r.data?.ayahs||[]);
          pd.current[p]=d;
        }catch{pd.current[p]=[];}
      })).then(doFlip);
    }
  },[uploadSpreadTex]);

  const flipFwd =React.useCallback(()=>startFlip(1), [startFlip]);
  const flipBwd =React.useCallback(()=>startFlip(-1),[startFlip]);

  const jumpTo=React.useCallback((pn)=>{
    const s=SR.current; if(s.phase!=="open")return;
    const p=Math.max(1,Math.min(_MUSHAF_PAGES,parseInt(pn)||1));
    s.spread=Math.ceil(p/2); s.curl=0; s.targetCurl=0; s.flipping=false;
    setSp(s.spread); setReady(false); setSmenu(false);
    prefetch(s.spread,()=>{
      uploadSpreadTex(s.spread,"cur");
      prefetch(s.spread+1,()=>uploadSpreadTex(s.spread+1,"next"));
      setReady(true);
    });
  },[prefetch,uploadSpreadTex]);

  // Keyboard
  React.useEffect(()=>{
    const h=e=>{if(e.key==="ArrowLeft")flipFwd();if(e.key==="ArrowRight")flipBwd();};
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[flipFwd,flipBwd]);

  const rp=2*sp-1, lp=Math.min(2*sp,_MUSHAF_PAGES);
  const BB={
    fontSize:9,letterSpacing:1.6,padding:"6px 14px",
    fontFamily:"'Cinzel',serif",
    background:"rgba(201,168,76,.07)",
    border:"1px solid rgba(201,168,76,.26)",
    color:"rgba(201,168,76,.68)",
    borderRadius:7,cursor:"pointer",transition:"all .18s",
  };
  const BBh=(e,on)=>{
    e.currentTarget.style.background=on?"rgba(201,168,76,.17)":"rgba(201,168,76,.07)";
    e.currentTarget.style.borderColor=on?"rgba(201,168,76,.52)":"rgba(201,168,76,.26)";
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",
      background:"radial-gradient(ellipse at 50% 28%,#1e0d03 0%,#060200 100%)",
      alignItems:"center",justifyContent:"space-between",
      overflow:"hidden",userSelect:"none",fontFamily:"'Cinzel',Georgia,serif"}}>

      {/* ambient floor */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"70%",height:55,pointerEvents:"none",
        background:"radial-gradient(ellipse,rgba(170,105,18,.13) 0%,transparent 70%)"}}/>

      {/* ── Top bar ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",
        maxWidth:sz.w+40,padding:"8px 16px",boxSizing:"border-box",flexShrink:0,
        background:"linear-gradient(to bottom,rgba(0,0,0,.42),transparent)",flexWrap:"wrap"}}>

        <button onClick={()=>navigate("/quran")} style={{...BB,flexShrink:0}}
          onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>← SOURATES</button>

        <div style={{fontFamily:"'Amiri Quran',serif",
          fontSize:Math.max(sz.w*.022,13),
          color:"rgba(201,168,76,.50)",direction:"rtl",flex:1,textAlign:"center",
          textShadow:"0 0 18px rgba(201,168,76,.18)"}}>القرآن الكريم</div>

        {ph==="open"&&<>
          {/* Surah picker */}
          <div style={{position:"relative",flexShrink:0}}>
            <button onClick={()=>setSmenu(v=>!v)} style={BB}
              onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>SOURATE ▾</button>
            {smenu&&(
              <div style={{position:"absolute",top:"115%",right:0,zIndex:200,
                background:"linear-gradient(160deg,#150902,#0d0500)",
                border:"1px solid rgba(201,168,76,.20)",borderRadius:10,
                maxHeight:260,overflowY:"auto",minWidth:220,
                boxShadow:"0 14px 55px rgba(0,0,0,.9)"}}>
                {surahs.map(s=>(
                  <div key={s.number}
                    onClick={()=>jumpTo(s.startPage||(s.number*2-1))}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",
                      cursor:"pointer",borderBottom:"1px solid rgba(201,168,76,.05)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(201,168,76,.1)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{fontSize:8,color:"rgba(201,168,76,.36)",minWidth:18,flexShrink:0}}>{s.number}</span>
                    <span style={{fontFamily:"'Amiri Quran',serif",fontSize:14,color:"#c9a84c",direction:"rtl"}}>{s.name}</span>
                    <span style={{fontSize:7,color:"rgba(201,168,76,.30)",marginLeft:"auto",flexShrink:0}}>{s.englishName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bookmark */}
          <button onClick={()=>{setBm(rp);localStorage.setItem("q3d_bm",String(rp));}}
            style={{...BB,fontSize:13,padding:"3px 7px",flexShrink:0,
              color:bm===rp?"#c0392b":"rgba(201,168,76,.35)"}}>🔖</button>
          {bm>0&&bm!==rp&&(
            <button onClick={()=>jumpTo(bm)} style={{...BB,flexShrink:0}}
              onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>p.{bm}</button>
          )}

          {/* Page jump */}
          <input type="number" defaultValue={rp} key={rp}
            onKeyDown={e=>e.key==="Enter"&&jumpTo(e.target.value)}
            onBlur={e=>jumpTo(e.target.value)}
            style={{width:44,textAlign:"center",background:"rgba(0,0,0,.22)",
              border:"1px solid rgba(201,168,76,.20)",borderRadius:6,
              padding:"4px 4px",color:"#c9a84c",fontSize:11,
              fontFamily:"'Cinzel',serif",outline:"none",flexShrink:0}}/>
          <span style={{fontSize:7,color:"rgba(201,168,76,.26)",flexShrink:0}}>/604</span>

          {/* Loading dot */}
          {!ready&&<div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,
            background:"rgba(201,168,76,.55)",
            animation:"q3dpulse 1s ease-in-out infinite"}}/>}
        </>}
      </div>

      {/* ── Book scene ── */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
        width:"100%",position:"relative"}}
        onTouchStart={e=>{tx0.current=e.touches[0].clientX;}}
        onTouchEnd={e=>{
          const dx=e.changedTouches[0].clientX-tx0.current;
          if(dx<-55)flipFwd(); if(dx>55)flipBwd();
        }}>

        <div style={{perspective:3600,perspectiveOrigin:"50% 38%",
          display:"flex",alignItems:"center",justifyContent:"center",
          width:sz.w+80,height:sz.h+60}}>

          <div style={{position:"relative",width:sz.w,height:sz.h,
            transform:ph==="cover"
              ? "rotateX(8deg) rotateY(-5deg)"
              : "rotateX(5deg) rotateY(0deg)",
            transformStyle:"preserve-3d",
            transition:"transform .7s cubic-bezier(.4,0,.2,1)",
            filter:`drop-shadow(0 ${sz.h*.11}px ${sz.h*.16}px rgba(0,0,0,.97))
                    drop-shadow(0 ${sz.h*.03}px ${sz.h*.05}px rgba(0,0,0,.70))`,
            cursor:ph==="cover"?"pointer":"default"}}
            onClick={ph==="cover"?openBook:undefined}>

            {/* ── Single WebGL canvas — renders everything ── */}
            <canvas ref={cvs3} width={sz.w} height={sz.h}
              style={{position:"absolute",top:0,left:0,display:"block",
                borderRadius:"1px 2px 2px 1px"}}/>

            {/* 3D Spine overlay (DOM element for depth) */}
            {ph==="open"&&(
              <div style={{position:"absolute",top:0,bottom:0,left:"50%",
                width:26,transform:"translateX(-50%) translateZ(1px)",
                zIndex:40,pointerEvents:"none",
                background:"linear-gradient(to right,#060200 0%,#321203 17%,#8a3a0e 33%,#d08c38 50%,#8a3a0e 67%,#321203 83%,#060200 100%)",
                boxShadow:"0 0 22px rgba(0,0,0,.88),inset 0 0 7px rgba(255,195,75,.10)"}}>
                <div style={{position:"absolute",inset:0,background:"repeating-linear-gradient(to bottom,transparent 0,transparent 22px,rgba(255,182,50,.06) 22px,rgba(255,182,50,.06) 23px)"}}/>
                <div style={{position:"absolute",top:0,bottom:0,left:"15%",width:1,background:"rgba(255,205,95,.10)"}}/>
                <div style={{position:"absolute",top:0,bottom:0,right:"15%",width:1,background:"rgba(255,205,95,.10)"}}/>
              </div>
            )}

            {/* Cover boards (top / bottom 3D depth) */}
            <div style={{position:"absolute",top:-6,left:3,right:3,height:7,
              background:"linear-gradient(135deg,#380d04,#7a2b0a,#380d04)",
              borderRadius:"2px 2px 0 0",
              boxShadow:"0 -3px 8px rgba(0,0,0,.65)"}}/>
            <div style={{position:"absolute",bottom:-6,left:3,right:3,height:7,
              background:"linear-gradient(135deg,#380d04,#7a2b0a,#380d04)",
              borderRadius:"0 0 2px 2px",
              boxShadow:"0 3px 8px rgba(0,0,0,.65)"}}/>

            {/* Click zones */}
            {ph==="open"&&<>
              <div onClick={flipBwd}
                style={{position:"absolute",top:0,right:0,width:"45%",height:"100%",
                  zIndex:50,cursor:"pointer"}}
                title="Page précédente (→)"/>
              <div onClick={flipFwd}
                style={{position:"absolute",top:0,left:0,width:"45%",height:"100%",
                  zIndex:50,cursor:"pointer"}}
                title="Page suivante (←)"/>
            </>}

            {/* Cover CTA */}
            {ph==="cover"&&(
              <div style={{position:"absolute",bottom:"19%",left:0,right:0,
                textAlign:"center",zIndex:60,pointerEvents:"none"}}>
                <div style={{display:"inline-block",
                  fontSize:Math.max(sz.w*.009,8),
                  letterSpacing:Math.max(sz.w*.003,2.5),
                  color:"rgba(201,168,76,.72)",
                  border:"1px solid rgba(201,168,76,.24)",
                  padding:`${Math.max(sz.h*.008,4)}px ${Math.max(sz.w*.02,13)}px`,
                  borderRadius:30,background:"rgba(0,0,0,.38)",
                  textShadow:"0 0 14px rgba(201,168,76,.40)",
                  animation:"q3dpulse 2.6s ease-in-out infinite"}}>
                  OUVRIR LE LIVRE
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side arrow hints */}
        {ph==="open"&&<>
          {[{side:"right",dir:-1,char:"›"},{side:"left",dir:1,char:"‹"}].map(({side,dir,char})=>(
            <div key={side}
              onClick={dir>0?flipFwd:flipBwd}
              style={{position:"absolute",[side]:Math.max(sz.w*.004,5),
                top:"50%",transform:"translateY(-50%)",zIndex:100,cursor:"pointer",
                fontSize:Math.max(sz.w*.03,20),color:"rgba(201,168,76,.17)",
                transition:"color .22s,transform .22s",userSelect:"none"}}
              onMouseEnter={e=>{e.currentTarget.style.color="rgba(201,168,76,.65)";e.currentTarget.style.transform="translateY(-50%) scale(1.18)";}}
              onMouseLeave={e=>{e.currentTarget.style.color="rgba(201,168,76,.17)";e.currentTarget.style.transform="translateY(-50%) scale(1)";}}>
              {char}
            </div>
          ))}
        </>}
      </div>

      {/* ── Bottom nav ── */}
      {ph==="open"&&(
        <div style={{display:"flex",alignItems:"center",gap:12,
          padding:"8px 0 14px",flexShrink:0,flexWrap:"wrap",justifyContent:"center"}}>
          <button style={BB} onClick={flipBwd} disabled={sp<=1}
            onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>→ PRÉC.</button>
          <div style={{textAlign:"center",minWidth:80}}>
            <div style={{fontSize:10,letterSpacing:2,color:"rgba(201,168,76,.48)"}}>
              {rp}{lp<=_MUSHAF_PAGES?"–"+lp:""}
            </div>
            <div style={{width:86,height:2,background:"rgba(201,168,76,.10)",
              borderRadius:2,marginTop:4,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:2,
                background:"linear-gradient(to right,#7a3c0a,#c9a84c)",
                width:`${(rp/_MUSHAF_PAGES)*100}%`,transition:"width .5s"}}/>
            </div>
          </div>
          <button style={BB} onClick={flipFwd} disabled={lp>=_MUSHAF_PAGES}
            onMouseEnter={e=>BBh(e,true)} onMouseLeave={e=>BBh(e,false)}>SUIV. ←</button>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Amiri+Quran&display=swap');
        @keyframes q3dpulse{0%,100%{opacity:.48;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(201,168,76,.22);border-radius:2px}
      `}</style>
    </div>
  );
}



// ─── UnknownWordQuestion ──────────────────────────────────────────────────────