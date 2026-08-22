import React, { useState } from "react";
import { SURAH_INFO } from "../../utils/quranData";

export function DonutChart({ pct, color, size = 80, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray .5s ease" }} />
    </svg>
  );
}

export function MiniBarChart({ data, color }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, height: `${(v/max)*100}%`, background: color, borderRadius: 2, minHeight: 2, opacity: v > 0 ? 1 : .2 }} />
      ))}
    </div>
  );
}

export function ActivityBarChart({ data = [], height = 60, goalLine = 0, onClick, selectedIdx }) {
  const maxVal = Math.max(...data.map(d => d.value), goalLine || 1, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height }}>
        {data.map((d, i) => {
          const h = (d.value / maxVal) * 100;
          const isSel = selectedIdx === i;
          return (
            <div key={i} onClick={() => onClick?.(i)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, height: "100%", justifyContent: "flex-end", cursor: "pointer" }}>
              <div style={{ width: "100%", height: `${h}%`, minHeight: d.value > 0 ? 3 : 0, background: isSel ? "var(--gold2)" : d.value >= goalLine && goalLine > 0 ? "var(--teal)" : "var(--border2)", borderRadius: 3, transition: "height .3s, background .2s" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 7, color: selectedIdx === i ? "var(--gold2)" : "var(--text3)", fontFamily: "'Cinzel',serif" }}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityCalendar({ activity, goals, learnData = {}, surahs = [] }) {
  const [viewDate, setViewDate] = useState(() => new Date());

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0
  const totalDays = lastDay.getDate();

  const MONTH_NAMES = ["JANVIER","FÉVRIER","MARS","AVRIL","MAI","JUIN","JUILLET","AOÛT","SEPTEMBRE","OCTOBRE","NOVEMBRE","DÉCEMBRE"];
  const DAY_NAMES   = ["LUN","MAR","MER","JEU","VEN","SAM","DIM"];

  const prevMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const todayStr = new Date().toISOString().slice(0, 10);
  const targetAyats = goals?.dailyAyats || 10;

  const daysCells = [];
  for (let i = 0; i < startDayOfWeek; i++) {
    daysCells.push({ empty: true });
  }
  for (let day = 1; day <= totalDays; day++) {
    const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const act = activity[dStr];
    const isToday = dStr === todayStr;

    let status = "none";
    if (act) {
      if ((act.readAyats || 0) >= targetAyats) status = "reached";
      else if ((act.readAyats || 0) > 0) status = "partial";
    }

    daysCells.push({ day, dateStr: dStr, act, isToday, status });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="cal-month-nav">
        <button onClick={prevMonth} className="cal-nav-btn">◄</button>
        <div className="cal-month-title">{MONTH_NAMES[month]} {year}</div>
        <button onClick={nextMonth} className="cal-nav-btn">►</button>
      </div>

      <div className="cal-grid">
        {DAY_NAMES.map(d => (
          <div key={d} className="cal-day-name">{d}</div>
        ))}
        {daysCells.map((c, i) => {
          if (c.empty) return <div key={i} className="cal-cell other-month" />;
          return (
            <div key={i} className={`cal-cell${c.isToday ? " today" : ""}${c.status === "reached" ? " goal-reached" : c.status === "partial" ? " goal-partial" : ""}`}
              title={c.act ? `${c.dateStr} : ${c.act.readAyats || 0} ayats lues` : c.dateStr}>
              <span className="cal-cell-num">{c.day}</span>
              {c.act && (c.act.readAyats > 0) && (
                <div className="cal-cell-dot" style={{ background: c.status === "reached" ? "var(--teal)" : "var(--gold2)" }} />
              )}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <div className="cal-legend-item">
          <div className="cal-legend-dot" style={{ background: "rgba(62,184,160,.3)", border: "1px solid var(--teal)" }} />
          <span>Objectif atteint</span>
        </div>
        <div className="cal-legend-item">
          <div className="cal-legend-dot" style={{ background: "rgba(201,168,76,.2)", border: "1px solid var(--gold)" }} />
          <span>Partiel</span>
        </div>
      </div>
    </div>
  );
}

export function GoalsPanel({ goals, todayAct, weeklyTotal, streak, goalAyatsPct, goalPartsPct, weeklyPct, onSetGoal, surahs }) {
  const [editingGoal, setEditingGoal] = useState(null);
  const [inputVal, setInputVal]       = useState("");

  const startEdit = (key, val) => {
    setEditingGoal(key);
    setInputVal(String(val));
  };

  const saveEdit = (key) => {
    const num = parseInt(inputVal, 10);
    if (!isNaN(num) && num > 0) {
      onSetGoal?.(key, num);
    }
    setEditingGoal(null);
  };

  const rows = [
    { key: "dailyAyats",  icon: "📖", label: "AYATS LUES / JOUR",    cur: todayAct.readAyats || 0,   target: goals.dailyAyats || 10, pct: goalAyatsPct },
    { key: "dailyParts",  icon: "🧩", label: "PARTIES APPRISES / JOUR", cur: todayAct.learnedParts || 0, target: goals.dailyParts || 2,  pct: goalPartsPct },
    { key: "weeklyMin",   icon: "⏱", label: "MINUTES / SEMAINE",    cur: weeklyTotal || 0,          target: goals.weeklyMin || 60,  pct: weeklyPct },
  ];

  return (
    <div className="goals-grid">
      <div className="goal-today-box">
        <div className="goal-today-stat">
          <div className="goal-today-val">{todayAct.readAyats || 0}</div>
          <div className="goal-today-label">AYATS AUJOURD'HUI</div>
        </div>
        <div className="goal-today-stat">
          <div className="goal-today-val">{todayAct.learnedParts || 0}</div>
          <div className="goal-today-label">PARTIES AUJOURD'HUI</div>
        </div>
        <div className="goal-streak">
          <div className="goal-streak-fire">🔥</div>
          <div>
            <div className="goal-streak-num">{streak || 0}</div>
            <div className="goal-streak-label">JOURS D'AFFILÉE</div>
          </div>
        </div>
      </div>

      {rows.map(({ key, icon, label, cur, target, pct }) => (
        <div key={key} className="goal-row">
          <div className="goal-icon">{icon}</div>
          <div className="goal-info">
            <div className="goal-label">{label}</div>
            <div className="goal-value">{cur} / {target}</div>
            <div className="goal-track" style={{ marginTop: 6 }}>
              <div className="goal-fill" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? "var(--green)" : "var(--teal)" }} />
            </div>
          </div>
          <div className="goal-pct">{pct}%</div>
          {editingGoal === key ? (
            <div style={{ display: "flex", gap: 4 }}>
              <input type="number" className="goal-input" value={inputVal} onChange={e => setInputVal(e.target.value)} autoFocus />
              <button className="goal-edit-btn" onClick={() => saveEdit(key)}>OK</button>
            </div>
          ) : (
            <button className="goal-edit-btn" onClick={() => startEdit(key, target)}>ÉDITER</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function KpiWidget({ totalLearned, totalRead, totalWords, totalParts, learnedParts, learnedSurahs, activeSurahs, pctAyats, entries, surahs, onNavigate }) {
  return (
    <div className="dash-kpi-row">
      <div className="dash-kpi" style={{ "--kpi-color": "var(--green)" }}>
        <div className="dash-kpi-val">{totalLearned}</div>
        <div className="dash-kpi-label">AYATS APPRISES</div>
        <div className="dash-kpi-sub">{pctAyats}% du Coran (6236)</div>
      </div>

      <div className="dash-kpi" style={{ "--kpi-color": "var(--gold)" }}>
        <div className="dash-kpi-val">{learnedSurahs}</div>
        <div className="dash-kpi-label">SOURATES COMPLÈTES</div>
        <div className="dash-kpi-sub">{activeSurahs} en cours</div>
      </div>

      <div className="dash-kpi" style={{ "--kpi-color": "var(--teal)" }}>
        <div className="dash-kpi-val">{learnedParts}</div>
        <div className="dash-kpi-label">PARTIES APPRISES</div>
        <div className="dash-kpi-sub">sur {totalParts} créées</div>
      </div>

      <div className="dash-kpi" style={{ "--kpi-color": "#c878ff" }}>
        <div className="dash-kpi-val">{totalWords}</div>
        <div className="dash-kpi-label">MOTS SURLIGNÉS</div>
        <div className="dash-kpi-sub">{totalRead} lectures totales</div>
      </div>
    </div>
  );
}

export default function DashboardPage({ learnData = {}, surahs = [], onNavigate, goals = {}, activity = {}, onSetGoal, onRecordActivity }) {
  const entries = Object.entries(learnData);

  let totalLearned = 0;
  let totalRead    = 0;
  let totalWords   = 0;
  let totalParts   = 0;
  let learnedParts = 0;
  let activeSurahs = 0;
  let learnedSurahs = 0;

  const surahStats = (surahs || []).map(s => {
    const sData = learnData[s.number] || {};
    const ayatsCount = s.numberOfAyahs || 1;
    const learnedInSurah = Object.values(sData).filter(a => a.learned).length;
    const pct = Math.round((learnedInSurah / ayatsCount) * 100);

    if (learnedInSurah === ayatsCount) learnedSurahs++;
    else if (learnedInSurah > 0) activeSurahs++;

    totalLearned += learnedInSurah;
    Object.values(sData).forEach(a => {
      totalRead += a.readCount || 0;
      totalWords += Object.keys(a.wordsLearned || {}).length;
      const parts = a.parts || [];
      totalParts += parts.length;
      learnedParts += parts.filter(p => p.learned).length;
    });

    return { ...s, learnedInSurah, pct };
  });

  const totalAyatsCoran = 6236;
  const pctAyats = Math.round((totalLearned / totalAyatsCoran) * 100);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayAct = activity[todayStr] || { readAyats: 0, learnedParts: 0, durationMin: 0 };

  const goalAyatsPct = Math.round(((todayAct.readAyats || 0) / (goals.dailyAyats || 10)) * 100);
  const goalPartsPct = Math.round(((todayAct.learnedParts || 0) / (goals.dailyParts || 2)) * 100);

  let weeklyTotal = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    weeklyTotal += activity[dStr]?.durationMin || 0;
  }
  const weeklyPct = Math.round((weeklyTotal / (goals.weeklyMin || 60)) * 100);

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    const act = activity[dStr];
    if (act && (act.readAyats > 0 || act.learnedParts > 0)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  const topSurahs = [...surahStats]
    .filter(s => s.learnedInSurah > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);

  return (
    <div className="dash-page page-anim">
      <KpiWidget
        totalLearned={totalLearned}
        totalRead={totalRead}
        totalWords={totalWords}
        totalParts={totalParts}
        learnedParts={learnedParts}
        learnedSurahs={learnedSurahs}
        activeSurahs={activeSurahs}
        pctAyats={pctAyats}
        entries={entries}
        surahs={surahs}
        onNavigate={onNavigate}
      />

      <div className="dash-two-col">
        <div className="dash-card">
          <div className="dash-section-title">🎯 OBJECTIFS & PROGRESSION</div>
          <GoalsPanel
            goals={goals}
            todayAct={todayAct}
            weeklyTotal={weeklyTotal}
            streak={streak}
            goalAyatsPct={goalAyatsPct}
            goalPartsPct={goalPartsPct}
            weeklyPct={weeklyPct}
            onSetGoal={onSetGoal}
            surahs={surahs}
          />
        </div>

        <div className="dash-card">
          <div className="dash-section-title">📅 CALENDRIER D'ACTIVITÉ</div>
          <ActivityCalendar activity={activity} goals={goals} learnData={learnData} surahs={surahs} />
        </div>
      </div>

      <div className="dash-card">
        <div className="dash-section-title">📖 PROGRESSION PAR SOURATE (TOP 10)</div>
        {topSurahs.length === 0 ? (
          <div className="dash-empty-hint">
            Aucune sourate en cours d'apprentissage. Commencer dans l'onglet CORAN.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {topSurahs.map(s => (
              <div key={s.number} className="dash-surah-bar" onClick={() => onNavigate?.(s.number, 1)}>
                <div className="dash-surah-num">{s.number}</div>
                <div className="dash-surah-name">{s.englishName}</div>
                <div className="dash-bar-track">
                  <div className="dash-bar-fill" style={{ width: `${s.pct}%` }} />
                </div>
                <div className="dash-bar-pct">{s.pct}%</div>
                <div className="dash-surah-ar">{s.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
