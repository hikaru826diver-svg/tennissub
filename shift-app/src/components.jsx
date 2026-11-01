import { daysInMonth, thisMonth, weekdayOf, WEEK } from "./utils.js";

export function MonthInput({ value, onChange, disabled }) {
  const shift = (n) => {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="row month-input">
      <button className="btn tiny ghost" disabled={disabled} onClick={() => shift(-1)}>◀</button>
      <input type="month" value={value} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button className="btn tiny ghost" disabled={disabled} onClick={() => shift(1)}>▶</button>
      {!disabled && value !== thisMonth() && <button className="btn tiny ghost" onClick={() => onChange(thisMonth())}>今月</button>}
    </div>
  );
}

/** 月カレンダー（複数日選択） */
export function CalendarPicker({ month, selected, marked = new Set(), onToggle, disabledDates = new Set() }) {
  const days = daysInMonth(month);
  const lead = weekdayOf(days[0]);
  const cells = [...Array(lead).fill(null), ...days];
  return (
    <div className="cal">
      {WEEK.map((w, i) => <div key={w} className={`cal-h wd${i}`}>{w}</div>)}
      {cells.map((d, i) =>
        d ? (
          <button key={d} disabled={disabledDates.has(d)} title={disabledDates.has(d) ? "コピー元の日" : undefined} className={`cal-d wd${weekdayOf(d)} ${selected[d] ? "sel" : ""} ${marked.has(d) ? "marked" : ""} ${disabledDates.has(d) ? "src" : ""}`} onClick={() => onToggle(d)}>
            {Number(d.slice(8))}
          </button>
        ) : (
          <div key={`e${i}`} />
        )
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="btn tiny ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function DeptSelect({ depts, value, onChange, allowAll }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">全部門</option>}
      {!allowAll && !value && <option value="">部門を選択</option>}
      {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}
