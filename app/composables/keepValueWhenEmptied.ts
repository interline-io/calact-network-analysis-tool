// Update handler for an `optional`, lazy numeric cat-input bound to a filter
// value. The filter inputs commit with `.lazy` (on leaving the field, Enter,
// or a step button), so each edit is one URL write and one refilter rather
// than one per keystroke. A field left empty emits undefined, as does text
// the browser can't read as a number (such as "2."). That, like a negative
// number, leaves the value as it is, and the field shows it again: clearing
// a field must not apply 0 as the threshold, or switch off a setting whose
// checkbox is derived from the value. Unticking the checkbox is how a filter
// is turned off.
export function keepValueWhenEmptied (target: { value: number | undefined }): (value: number | undefined) => void {
  return (value) => {
    // A negative is no valid threshold or distance either; the setters would
    // store it as "no value" and switch the filter off.
    if (value != null && Number.isFinite(value) && value >= 0) {
      target.value = value
    }
  }
}
