import React, { useState, useEffect } from "react";
import { fetchQuranPage } from "../../services/quranApi";

const MUSHAF_TOTAL = 604;

export default function QuranBookPage({ surahs = [] }) {
  const [pageNum, setPageNum] = useState(1);
  const [ayahs, setAyahs]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchQuranPage(pageNum).then(data => {
      if (!cancelled) {
        setAyahs(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [pageNum]);

  return (
    <div className="qbook-wrapper page-anim">
      <div className="qbook-topbar">
        <button className="qbook-open-btn" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? "📖 FERMER LE MUSHAF" : "📖 OUVRIR LE MUSHAF 3D"}
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "var(--gold2)", fontFamily: "'Cinzel',serif", letterSpacing: 1 }}>
            PAGE {pageNum} / {MUSHAF_TOTAL}
          </span>
        </div>
      </div>

      <div className="qbook-scene">
        <div className={`qbook${isOpen ? " qbook-open" : ""}`} style={{ width: 340, height: 480 }}>
          <div className="qbook-pages">
            <li />
            <li />
            <li />
          </div>

          <div className="qbook-page">
            <div className="qbook-page-face">
              <div className="qbook-page-content">
                {loading ? (
                  <div className="qbook-loading-page">القرآن الكريم</div>
                ) : (
                  <div className="qbook-ayah-text">
                    {ayahs.map(a => (
                      <span key={a.number}>
                        {a.text}{" "}
                        <span className="qbook-ayah-num">﴿{a.numberInSurah}﴾</span>{" "}
                      </span>
                    ))}
                  </div>
                )}
                <div className="qbook-page-num">PAGE {pageNum}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="qbook-botnav">
        <button
          className="qbook-navbtn"
          disabled={pageNum >= MUSHAF_TOTAL}
          onClick={() => setPageNum(p => Math.min(MUSHAF_TOTAL, p + 1))}
        >
          ◄ PAGE SUIVANTE
        </button>
        <span className="qbook-navlabel">PAGE {pageNum}</span>
        <button
          className="qbook-navbtn"
          disabled={pageNum <= 1}
          onClick={() => setPageNum(p => Math.max(1, p - 1))}
        >
          PAGE PRÉCÉDENTE ►
        </button>
      </div>
    </div>
  );
}
