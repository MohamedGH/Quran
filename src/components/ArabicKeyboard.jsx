import React, { createContext, useContext, useState } from "react";

export const ArabicKeyboardContext = createContext({
  show: false,
  setShow: () => {},
  activeInput: { current: null },
});

export function useArabicKeyboard() {
  return useContext(ArabicKeyboardContext);
}

const AR_ROWS = [
  ['ض','ص','ث','ق','ف','غ','ع','ه','خ','ح','ج','د','ذ'],
  ['ش','س','ي','ب','ل','ا','ت','ن','م','ك','ط','ظ'],
  ['ئ','ء','ؤ','ر','لا','ى','ة','و','ز','سّ'],
];

const AR_DIACRITICS = [
  { label:'َ', title:'Fatha' },
  { label:'ُ', title:'Damma' },
  { label:'ِ', title:'Kasra' },
  { label:'ً', title:'Tanwin fath' },
  { label:'ٌ', title:'Tanwin damm' },
  { label:'ٍ', title:'Tanwin kasr' },
  { label:'ّ', title:'Shadda' },
  { label:'ْ', title:'Sukun' },
  { label:'ٰ', title:'Dagger alif' },
];

export default function ArabicKeyboard({ show, onClose }) {
  const { activeInput } = useArabicKeyboard();
  const [capsHamza, setCapsHamza] = useState(false);

  const insert = (char) => {
    const el = activeInput.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const before = el.value.slice(0, start);
    const after  = el.value.slice(end);
    const newVal = before + char + after;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    nativeSetter?.set?.call(el, newVal);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const newPos = start + char.length;
    el.setSelectionRange(newPos, newPos);
    el.focus();
  };

  const backspace = () => {
    const el = activeInput.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    if (start !== end) {
      insert('');
    } else if (start > 0) {
      const before = el.value.slice(0, start - 1);
      const after  = el.value.slice(start);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      nativeSetter?.set?.call(el, before + after);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.setSelectionRange(start - 1, start - 1);
      el.focus();
    }
  };

  const HAMZA_MAP = {
    'ا': 'أ', 'و': 'ؤ', 'ي': 'ئ', 'ه': 'ه',
  };

  if (!show) return null;
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:9999,
      background:'var(--surface2)', borderTop:'1px solid var(--border)',
      padding:'8px 6px 12px', boxShadow:'0 -4px 24px rgba(0,0,0,.4)',
      userSelect:'none' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontSize:8, letterSpacing:2, color:'var(--text3)', fontFamily:"'Cinzel',serif" }}>CLAVIER ARABE</div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => setCapsHamza(v => !v)}
            style={{ fontSize:9, padding:'3px 10px', borderRadius:6,
              background: capsHamza ? 'rgba(201,168,76,.18)' : 'transparent',
              border:'1px solid ' + (capsHamza ? 'var(--gold)' : 'var(--border2)'),
              color: capsHamza ? 'var(--gold2)' : 'var(--text3)', cursor:'pointer' }}>
            ء HAMZA
          </button>
          <button onClick={onClose}
            style={{ fontSize:11, padding:'3px 10px', borderRadius:6,
              background:'transparent', border:'1px solid var(--border2)',
              color:'var(--text3)', cursor:'pointer' }}>✕</button>
        </div>
      </div>

      {AR_ROWS.map((row, ri) => (
        <div key={ri} style={{ display:'flex', justifyContent:'center', gap:3, marginBottom:3 }}>
          {row.map((ch) => {
            const display = capsHamza && HAMZA_MAP[ch] ? HAMZA_MAP[ch] : ch;
            return (
              <button key={ch} onClick={() => insert(display)}
                style={{ minWidth:32, height:38, fontSize:18, borderRadius:6,
                  fontFamily:"'Amiri Quran',serif", border:'1px solid var(--border2)',
                  background:'var(--surface3)', color:'var(--text)',
                  cursor:'pointer', direction:'rtl', padding:'0 4px',
                  transition:'background .1s', flexShrink:0 }}>
                {display}
              </button>
            );
          })}
          {ri === 2 && (
            <button onClick={backspace}
              style={{ minWidth:44, height:38, fontSize:14, borderRadius:6,
                border:'1px solid var(--border2)', background:'rgba(224,90,90,.12)',
                color:'var(--red)', cursor:'pointer', flexShrink:0 }}>
              ⌫
            </button>
          )}
        </div>
      ))}

      <div style={{ display:'flex', justifyContent:'center', gap:3, marginTop:4 }}>
        {AR_DIACRITICS.map(({ label, title }) => (
          <button key={label} onClick={() => insert(label)} title={title}
            style={{ minWidth:32, height:32, fontSize:14, borderRadius:6,
              fontFamily:"'Amiri Quran',serif", border:'1px solid var(--border2)',
              background:'rgba(201,168,76,.08)', color:'var(--gold2)',
              cursor:'pointer', padding:'0 4px', flexShrink:0 }}>
            د{label}
          </button>
        ))}
        <button onClick={() => insert(' ')}
          style={{ minWidth:80, height:32, fontSize:9, borderRadius:6,
            border:'1px solid var(--border2)', background:'var(--surface3)',
            color:'var(--text3)', cursor:'pointer', letterSpacing:2, fontFamily:"'Cinzel',serif" }}>
          ESPACE
        </button>
      </div>
    </div>
  );
}
