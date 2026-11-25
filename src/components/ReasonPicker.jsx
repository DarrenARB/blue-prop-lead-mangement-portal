import { useState } from "react";

// Ready-made reasons for Do Not Contact, so people tap one instead of typing. "Other" lets them write their own.
export const DNC_ADD_REASONS = [
  "Asked not to be contacted again",
  "Not interested in buying, selling or renting",
  "Wrong number",
  "Already working with another agent",
  "Already sold, bought or moved",
  "Already a Blue PROP client",
  "Complained about the messages",
];
export const DNC_BULK_REASONS = [
  "Imported from another opt-out list",
  "Asked not to be contacted again",
  "Existing Blue PROP clients",
  "Wrong or old numbers",
];
export const DNC_REMOVE_REASONS = [
  "The AI got it wrong: they didn’t ask to stop",
  "They asked to hear from us again",
  "Added by mistake (wrong person)",
  "The number now belongs to someone else",
];
const OTHER = "__other";

// value is the reason text. A preset is stored word for word; "Other" stores what was typed.
export default function ReasonPicker({ id, label = "Reason", reasons, value, onChange, hint, required }) {
  const isPreset = reasons.includes(value);
  const [other, setOther] = useState(!!value && !isPreset);
  const choice = other ? OTHER : isPreset ? value : "";
  function pick(v) {
    if (v === OTHER) { setOther(true); onChange(isPreset ? "" : value); }
    else { setOther(false); onChange(v); }
  }
  return (
    <fieldset className="reason-picker" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend>{label}{required ? "" : <span className="muted small"> (optional)</span>}</legend>
      {hint && <p id={`${id}-hint`} className="small muted" style={{ margin: "0 0 6px" }}>{hint}</p>}
      <div className="reason-opts">
        {[...reasons, OTHER].map((r) => (
          <label key={r} className={`reason-opt ${choice === r ? "on" : ""}`}>
            <input type="radio" name={id} value={r} checked={choice === r} onChange={() => pick(r)} required={required} />
            <span>{r === OTHER ? "Other (write your own)" : r}</span>
          </label>
        ))}
      </div>
      {other && (
        <input id={`${id}-other`} className="input" style={{ marginTop: 8 }} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="Write the reason" aria-label="Your reason" autoFocus required={required} maxLength={200} />
      )}
    </fieldset>
  );
}
