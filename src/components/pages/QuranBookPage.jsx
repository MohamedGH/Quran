import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { fetchQuranPage } from "../../services/quranApi";
import "./QuranBookPage.css";

const MUSHAF_TOTAL = 604;

export default function QuranBookPage({ surahs = [] }) {
  const navigate = useNavigate();
  const [spread,    setSpread]    = useState(0);    // 0 = cover closed
  const [flipState, setFlipState] = useState('idle'); // 'idle'|'fwd'|'bwd'
  const [pageCache, setPageCache] = useState({});
  const [inputVal,  setInputVal]  = useState('1');
  const [bookOpen,  setBookOpen]  = useState(false);
  const [sz,        setSz]        = useState({ w: 440, h: 560 });
  const [showSurahMenu, setShowSurahMenu] = useState(false);
  const [bookmark,  setBookmark]  = useState(() => {
    try { return parseInt(localStorage.getItem('quranbook_bm')) || null; } catch { return null; }
  });

  // Responsive single-page width (book shows one spread = two half-pages)
  useEffect(() => {
    const upd = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const maxH = vh - 160;
      const maxW = Math.min((vw - 40) / 2, maxH * 0.68, 440);
      setSz({ w: Math.round(maxW), h: Math.round(maxW / 0.68) });
    };
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);

  const rPage = spread === 0 ? null : 2 * spread - 1;
  const lPage = spread === 0 ? null : Math.min(2 * spread, MUSHAF_TOTAL);

  const loadPage = useCallback(async (n) => {
    if (!n || n < 1 || n > MUSHAF_TOTAL || pageCache[n] !== undefined) return;
    setPageCache(c => ({ ...c, [n]: null }));
    try {
      const data = await fetchQuranPage(n);
      setPageCache(c => ({ ...c, [n]: data }));
    } catch {
      setPageCache(c => ({ ...c, [n]: [] }));
    }
  }, [pageCache]);

  useEffect(() => {
    if (spread === 0) return;
    [rPage, lPage, rPage ? rPage + 2 : null, lPage ? lPage + 2 : null, rPage ? rPage - 2 : null, lPage ? lPage - 2 : null]
      .filter(Boolean).forEach(loadPage);
  }, [spread, rPage, lPage, loadPage]);

  useEffect(() => {
    if (rPage) setInputVal(String(rPage));
  }, [rPage]);

  const openBook = useCallback(() => {
    if (bookOpen) return;
    setBookOpen(true);
    setTimeout(() => {
      setSpread(1);
      setFlipState('idle');
    }, 820);
  }, [bookOpen]);

  const closeBook = useCallback(() => {
    setBookOpen(false);
    setTimeout(() => setSpread(0), 820);
  }, []);

  const goNext = useCallback(async () => {
    if (flipState !== 'idle' || !lPage || lPage >= MUSHAF_TOTAL) return;
    const np1 = rPage + 2, np2 = lPage + 2;
    await Promise.all([np1, np2].filter(p => p >= 1 && p <= MUSHAF_TOTAL && pageCache[p] === undefined)
      .map(async p => {
        setPageCache(c => ({ ...c, [p]: null }));
        try { const d = await fetchQuranPage(p); setPageCache(c => ({ ...c, [p]: d })); }
        catch { setPageCache(c => ({ ...c, [p]: [] })); }
      }));
    setFlipState('fwd');
    setTimeout(() => { setSpread(s => s + 1); setFlipState('idle'); }, 720);
  }, [flipState, lPage, rPage, pageCache]);

  const goPrev = useCallback(async () => {
    if (flipState !== 'idle' || spread <= 1) return;
    const pp1 = rPage - 2, pp2 = lPage ? lPage - 2 : null;
    await Promise.all([pp1, pp2].filter(p => p && p >= 1 && pageCache[p] === undefined)
      .map(async p => {
        setPageCache(c => ({ ...c, [p]: null }));
        try { const d = await fetchQuranPage(p); setPageCache(c => ({ ...c, [p]: d })); }
        catch { setPageCache(c => ({ ...c, [p]: [] })); }
      }));
    setFlipState('bwd');
    setTimeout(() => { setSpread(s => s - 1); setFlipState('idle'); }, 720);
  }, [flipState, spread, rPage, lPage, pageCache]);

  const jumpTo = (v) => {
    const p = Math.max(1, Math.min(MUSHAF_TOTAL, parseInt(v, 10) || 1));
    setSpread(Math.ceil(p / 2));
    if (!bookOpen) { setBookOpen(true); }
  };

  useEffect(() => {
    const h = e => {
      if (e.key === 'ArrowLeft')  goNext();
      if (e.key === 'ArrowRight') goPrev();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [goNext, goPrev]);

  const tx = useRef(0);
  const isFwd  = flipState === 'fwd';
  const isBwd  = flipState === 'bwd';
  const isFlip = isFwd || isBwd;

  const PageContent = useCallback(({ pageNum, side }) => {
    const ayahs = pageCache[pageNum];
    if (!pageNum) return null;
    if (ayahs === undefined || ayahs === null)
      return <div className="qbook-loading-page">القرآن</div>;

    const groups = [];
    (ayahs || []).forEach(a => {
      const last = groups[groups.length - 1];
      if (!last || last.sn !== a.surah.number)
        groups.push({ sn: a.surah.number, name: a.surah.name, eng: a.surah.englishName, ayahs: [] });
      groups[groups.length - 1].ayahs.push(a);
    });

    const fs = Math.max(Math.min(sz.h / 20, sz.w / 14, 16), 10);

    return (
      <div className={`qbook-page-content${side === 'right' ? ' qbook-page-content-right' : ''}`}>
        {groups.map((g, gi) => (
          <React.Fragment key={gi}>
            {g.ayahs[0]?.numberInSurah === 1 && (
              <>
                <div className="qbook-surah-header">
                  {g.eng.toUpperCase()}
                  <span style={{ fontFamily:"'Amiri Quran',serif", fontSize:'1.3em', margin:'0 5px' }}>{g.name}</span>
                </div>
                {g.sn !== 9 && (
                  <div className="qbook-basmala" style={{ fontSize: fs + 1 }}>
                    بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
                  </div>
                )}
              </>
            )}
            <div className="qbook-ayah-text" style={{ fontSize: fs }}>
              {g.ayahs.map(a => (
                <React.Fragment key={a.numberInSurah}>
                  {a.text}<span className="qbook-ayah-num">﴿{a.numberInSurah}﴾</span>{' '}
                </React.Fragment>
              ))}
            </div>
          </React.Fragment>
        ))}
        <div className="qbook-page-num">{pageNum}</div>
      </div>
    );
  }, [pageCache, sz]);

  const spineW = Math.max(Math.round(sz.w * 0.052), 20);
  const totalW = sz.w * 2 + spineW;

  return (
    <div className="qbook-wrapper">
      {/* ── Top bar ── */}
      <div className="qbook-topbar" style={{ maxWidth: totalW + 60 }}>
        <button onClick={() => navigate('/quran')}
          style={{ fontSize:8,letterSpacing:1.5,padding:'4px 12px',fontFamily:"'Cinzel',serif",
            background:'transparent',border:'1px solid rgba(201,168,76,.25)',
            color:'rgba(201,168,76,.55)',borderRadius:6,cursor:'pointer',flexShrink:0 }}>
          ← SOURATES
        </button>

        {/* Surah picker */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <button onClick={() => setShowSurahMenu(v => !v)}
            style={{ fontSize:8,letterSpacing:1.2,padding:'4px 10px',fontFamily:"'Cinzel',serif",
              background:'rgba(201,168,76,.07)',border:'1px solid rgba(201,168,76,.22)',
              color:'rgba(201,168,76,.6)',borderRadius:6,cursor:'pointer' }}>
            SOURATE ▾
          </button>
          {showSurahMenu && (
            <div style={{ position:'absolute',top:'115%',left:0,zIndex:300,minWidth:240,
              background:'#120701',border:'1px solid rgba(201,168,76,.2)',borderRadius:8,
              maxHeight:260,overflowY:'auto',boxShadow:'0 10px 40px rgba(0,0,0,.85)' }}>
              {surahs.map(s => (
                <div key={s.number}
                  onClick={() => { jumpTo(s.startPage || s.number * 2 - 1); setShowSurahMenu(false); }}
                  style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 12px',
                    cursor:'pointer',borderBottom:'1px solid rgba(201,168,76,.05)' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(201,168,76,.1)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{ fontSize:8,color:'rgba(201,168,76,.4)',minWidth:20 }}>{s.number}</span>
                  <span style={{ fontFamily:"'Amiri Quran',serif",fontSize:14,color:'#c9a84c',direction:'rtl' }}>{s.name}</span>
                  <span style={{ fontSize:7,color:'rgba(201,168,76,.35)',marginLeft:'auto' }}>{s.englishName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontFamily:"'Amiri Quran',serif",fontSize:Math.max(sz.w*.044,16),
          color:'rgba(201,168,76,.48)',direction:'rtl',textAlign:'center',flex:1,
          textShadow:'0 0 16px rgba(201,168,76,.2)' }}>
          القرآن الكريم
        </div>

        {/* Bookmark */}
        <button onClick={() => { setBookmark(rPage); if(rPage) localStorage.setItem('quranbook_bm', String(rPage)); }}
          style={{ fontSize:14,background:'transparent',border:'none',cursor:'pointer',flexShrink:0,
            color: bookmark === rPage ? '#c0392b' : 'rgba(201,168,76,.32)' }}>🔖</button>
        {bookmark && rPage && bookmark !== rPage && (
          <button onClick={() => jumpTo(bookmark)}
            style={{ fontSize:8,letterSpacing:1,padding:'4px 8px',fontFamily:"'Cinzel',serif",
              background:'rgba(192,57,43,.14)',border:'1px solid rgba(192,57,43,.28)',
              color:'rgba(220,100,80,.7)',borderRadius:6,cursor:'pointer',flexShrink:0 }}>
            p.{bookmark}
          </button>
        )}

        {/* Page input */}
        {bookOpen && (
          <div style={{ display:'flex',alignItems:'center',gap:4,flexShrink:0 }}>
            <span style={{ fontSize:7,color:'rgba(201,168,76,.4)',fontFamily:"'Cinzel',serif" }}>P.</span>
            <input type="number" value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && jumpTo(inputVal)}
              onBlur={() => jumpTo(inputVal)}
              style={{ width:44,textAlign:'center',background:'transparent',
                border:'1px solid rgba(201,168,76,.22)',borderRadius:6,
                padding:'3px 5px',color:'var(--gold)',fontSize:12,
                fontFamily:"'Cinzel',serif",outline:'none' }} />
            <span style={{ fontSize:7,color:'rgba(201,168,76,.25)',fontFamily:"'Cinzel',serif" }}>/604</span>
          </div>
        )}
      </div>

      {/* ── Book scene ── */}
      <div className="qbook-scene"
        onTouchStart={e => { tx.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - tx.current;
          if (dx < -55) goNext(); if (dx > 55) goPrev();
        }}>

        <div style={{ position:'absolute',bottom:'8%',left:'50%',transform:'translateX(-50%)',
          width:'55%',height:30,pointerEvents:'none',
          background:'radial-gradient(ellipse,rgba(180,110,20,.16) 0%,transparent 70%)' }}/>

        {/* ── THE BOOK ── */}
        <div style={{
          position:'relative',
          width: totalW,
          height: sz.h,
          transformStyle:'preserve-3d',
          transform:'rotateX(4deg)',
          filter:`drop-shadow(0 ${sz.h*.12}px ${sz.h*.16}px rgba(0,0,0,.95)) drop-shadow(0 8px 24px rgba(0,0,0,.6))`,
        }}>

          {/* ── HARDCOVER BACK ── */}
          <ul style={{ listStyle:'none',margin:0,padding:0,
            position:'absolute',top:0,left:0,width:sz.w,height:sz.h,
            transformStyle:'preserve-3d',zIndex:0 }}>
            <li style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
              borderRadius:'3px 0 0 3px',
              background:'linear-gradient(135deg,#200800,#4a1508,#200800)',
              boxShadow:'-4px 0 12px rgba(0,0,0,.5),inset 4px 0 10px rgba(0,0,0,.3)' }}/>
            <li style={{ position:'absolute',top:4,right:-spineW*.35,
              width:spineW*.35, height:'calc(100% - 8px)',
              background:'linear-gradient(to right,#1a0500,#0e0200)',
              borderRadius:'0 2px 2px 0' }}/>
          </ul>

          {/* ── STACKED PAGES ── */}
          <ul style={{ listStyle:'none',margin:0,padding:0,
            position:'absolute',top:3,left:3,
            width: sz.w * 2 + spineW - 6, height: sz.h - 6,
            transformStyle:'preserve-3d',zIndex:1 }}>
            {[0,1,2,3,4].map(k => (
              <li key={k} style={{
                position:'absolute',top:0,left:0,width:'100%',height:'100%',
                borderRadius:'0 2px 2px 0',
                background: ['#ede1bb','#f0e4c0','#f3e7c6','#f6eacc','#f9edd2'][k],
                transform:`translateX(${-k}px)`,
              }}/>
            ))}
          </ul>

          {/* ── LEFT PAGE ── */}
          <div style={{ position:'absolute',top:0,left:0,width:sz.w,height:sz.h,zIndex:2,overflow:'hidden',
            background:'linear-gradient(160deg,#fef9ee,#fdf3d8,#faecc0)',
            borderRadius:'2px 0 0 2px',
            boxShadow:'inset 8px 0 20px rgba(0,0,0,.08)' }}>
            {bookOpen && <PageContent pageNum={isFwd ? (lPage ? lPage + 2 : null) : lPage} side="left" />}
          </div>

          {/* ── RIGHT PAGE ── */}
          <div style={{ position:'absolute',top:0,left:sz.w + spineW,width:sz.w,height:sz.h,zIndex:2,
            overflow:'hidden',
            background:'linear-gradient(160deg,#fef9ee,#fdf3d8,#faecc0)',
            borderRadius:'0 2px 2px 0',
            boxShadow:'inset -8px 0 20px rgba(0,0,0,.08)' }}>
            {bookOpen && <PageContent pageNum={isBwd ? (rPage ? rPage - 2 : null) : rPage} side="right" />}
          </div>

          {/* ── SPINE ── */}
          <div style={{ position:'absolute',top:0,left:sz.w,width:spineW,height:sz.h,zIndex:20,
            background:`linear-gradient(to right,#0a0200 0%,#3a1204 18%,#8a3810 34%,#d08c38 50%,#8a3810 66%,#3a1204 82%,#0a0200 100%)`,
            boxShadow:'0 0 18px rgba(0,0,0,.7),inset 0 0 6px rgba(255,195,70,.08)' }}>
            <div style={{ position:'absolute',inset:0,
              background:'repeating-linear-gradient(to bottom,transparent 0,transparent 20px,rgba(255,190,60,.07) 20px,rgba(255,190,60,.07) 21px)' }}/>
          </div>

          {/* ── FLIPPING PAGE ── */}
          {isFlip && (
            <div className={`qbook-page${isFwd ? ' qbook-flip-fwd' : ' qbook-flip-bwd'}`}
              style={{
                position:'absolute',top:0,
                left: isFwd ? 0 : sz.w + spineW,
                width:sz.w,height:sz.h,
                transformOrigin: isFwd ? 'right center' : 'left center',
                transformStyle:'preserve-3d',zIndex:200,
              }}>
              <div className="qbook-page-face">
                <PageContent pageNum={isFwd ? lPage : rPage} side={isFwd ? 'left' : 'right'} />
              </div>
              <div className="qbook-page-face qbook-page-face-back">
                <PageContent pageNum={isFwd ? (rPage ? rPage + 2 : null) : (lPage ? lPage - 2 : null)} side={isFwd ? 'right' : 'left'} />
              </div>
            </div>
          )}

          {/* ── HARDCOVER FRONT ── */}
          <ul className={`qbook-hc-front${bookOpen ? ' qbook-open' : ''}`}
            style={{ listStyle:'none',margin:0,padding:0,
              position:'absolute',top:0,
              left: sz.w + spineW,
              width:sz.w,height:sz.h,
              transformStyle:'preserve-3d',
              transformOrigin:'left center',
              transition:'transform .82s cubic-bezier(.645,.045,.355,1)',
              transform: bookOpen ? 'rotateY(-175deg)' : 'rotateY(0deg)',
              zIndex:bookOpen ? 5 : 150,
            }}>
            <li style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
              backfaceVisibility:'hidden',borderRadius:'0 3px 3px 0',overflow:'hidden',
              background:'linear-gradient(135deg,#280b01 0%,#561c05 30%,#8b3210 50%,#561c05 70%,#280b01 100%)',
              boxShadow:'inset -8px 0 24px rgba(0,0,0,.45),inset 0 0 40px rgba(0,0,0,.28)' }}>
              <div className="qbook-cover-design">
                <div className="qbook-medallion">☽</div>
                <div className="qbook-cover-title">القرآن الكريم</div>
                <div className="qbook-cover-sub">THE NOBLE QURAN</div>
                {!bookOpen && (
                  <button className="qbook-open-btn" style={{ marginTop:16 }}
                    onClick={openBook}>
                    OUVRIR LE LIVRE
                  </button>
                )}
              </div>
            </li>
            <li style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',
              backfaceVisibility:'hidden',transform:'rotateY(180deg)',
              borderRadius:'0 3px 3px 0',overflow:'hidden',
              background:'linear-gradient(to right,#1c0601,#3a1008)',
              display:'flex',alignItems:'center',justifyContent:'center' }}>
              <div style={{ fontFamily:"'Amiri Quran',serif",fontSize:'1.8em',
                color:'rgba(201,168,76,.22)',direction:'rtl' }}>﷽</div>
            </li>
          </ul>

          {/* ── Click zones ── */}
          {bookOpen && !isFlip && <>
            <div className="qbook-click qbook-click-left"
              style={{ left:0, width:sz.w*.46, height:sz.h, position:'absolute',top:0,zIndex:250,cursor:'pointer' }}
              onClick={goNext} title="Suivant (←)" />
            <div className="qbook-click qbook-click-right"
              style={{ left:sz.w + spineW + sz.w*.54, width:sz.w*.46, height:sz.h, position:'absolute',top:0,zIndex:250,cursor:'pointer' }}
              onClick={goPrev} title="Précédent (→)" />
          </>}

          {/* ── Top & bottom hardcover boards ── */}
          <div style={{ position:'absolute',top:-5,left:0,right:0,height:6,
            background:'linear-gradient(to bottom,#1e0602,#5a1a08)',
            borderRadius:'2px 2px 0 0',boxShadow:'0 -2px 8px rgba(0,0,0,.5)' }}/>
          <div style={{ position:'absolute',bottom:-5,left:0,right:0,height:6,
            background:'linear-gradient(to top,#1e0602,#5a1a08)',
            borderRadius:'0 0 2px 2px',boxShadow:'0 2px 8px rgba(0,0,0,.5)' }}/>
        </div>
      </div>

      {/* ── Bottom nav ── */}
      <div className="qbook-botnav">
        {bookOpen ? (<>
          <button className="qbook-navbtn" onClick={goPrev} disabled={spread <= 1 || isFlip}>
            → PRÉC.
          </button>

          <div style={{ textAlign:'center', minWidth:80 }}>
            <div className="qbook-navlabel">
              {rPage}{lPage && lPage <= MUSHAF_TOTAL ? '–' + lPage : ''}
            </div>
            <div className="qbook-progress">
              <div className="qbook-progress-bar"
                style={{ width:`${rPage ? (rPage/MUSHAF_TOTAL)*100 : 0}%` }}/>
            </div>
          </div>

          <button className="qbook-navbtn" onClick={goNext}
            disabled={!lPage || lPage >= MUSHAF_TOTAL || isFlip}>
            SUIV. ←
          </button>

          <button className="qbook-navbtn" onClick={closeBook}
            style={{ fontSize:8,padding:'5px 12px',opacity:.6 }}>
            ✕ FERMER
          </button>
        </>) : (
          <button className="qbook-navbtn" onClick={openBook}>
            📖 OUVRIR LE LIVRE
          </button>
        )}
      </div>
    </div>
  );
}
