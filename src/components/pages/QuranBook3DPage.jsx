import React, { useState, useEffect, useRef } from "react";
import { fetchQuranPage } from "../../services/quranApi";

const MUSHAF_TOTAL = 604;

function _drawPageText(ctx, ayahs, pn, x0, y0, w, h) {
  ctx.fillStyle = "#fdf3d8";
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = "#1a0a03";
  ctx.font = "20px 'Amiri Quran', serif";
  ctx.direction = "rtl";
  ctx.textAlign = "right";

  let y = y0 + 40;
  const lineH = 32;
  const str = ayahs.map(a => `${a.text} ﴿${a.numberInSurah}﴾`).join(" ");
  const words = str.split(" ");
  let line = "";

  for (const word of words) {
    const testLine = line + word + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > w - 40 && line !== "") {
      ctx.fillText(line, x0 + w - 20, y);
      line = word + " ";
      y += lineH;
      if (y > y0 + h - 40) break;
    } else {
      line = testLine;
    }
  }
  if (line && y <= y0 + h - 40) {
    ctx.fillText(line, x0 + w - 20, y);
  }

  ctx.fillStyle = "rgba(120,76,20,.48)";
  ctx.font = "12px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.fillText(`PAGE ${pn}`, x0 + w / 2, y0 + h - 15);
}

export default function QuranBook3DPage({ surahs = [] }) {
  const [pn, setPn]           = useState(1);
  const [leftAyahs, setLeft]  = useState([]);
  const [rightAyahs, setRight] = useState([]);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchQuranPage(pn),
      pn + 1 <= MUSHAF_TOTAL ? fetchQuranPage(pn + 1) : Promise.resolve([]),
    ]).then(([lData, rData]) => {
      if (!cancelled) {
        setLeft(lData);
        setRight(rData);
      }
    });
    return () => { cancelled = true; };
  }, [pn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width = 1024;
    const H = canvas.height = 768;

    ctx.fillStyle = "#0c0501";
    ctx.fillRect(0, 0, W, H);

    _drawPageText(ctx, leftAyahs, pn, 50, 50, W / 2 - 60, H - 100);
    _drawPageText(ctx, rightAyahs, pn + 1, W / 2 + 10, 50, W / 2 - 60, H - 100);
  }, [leftAyahs, rightAyahs, pn]);

  return (
    <div className="qbook-wrapper page-anim">
      <div className="qbook-topbar">
        <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
          📖 MUSHAF 3D RENDU (WEBGL / CANVAS 2D)
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className="qbook-navbtn"
            disabled={pn <= 1}
            onClick={() => setPn(p => Math.max(1, p - 2))}
          >
            ◄ PAGE PRÉCÉDENTE
          </button>
          <button
            className="qbook-navbtn"
            disabled={pn >= MUSHAF_TOTAL - 1}
            onClick={() => setPn(p => Math.min(MUSHAF_TOTAL - 1, p + 2))}
          >
            PAGE SUIVANTE ►
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, padding: 20 }}>
        <canvas ref={canvasRef} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, boxShadow: "0 12px 36px rgba(0,0,0,.6)" }} />
      </div>
    </div>
  );
}
