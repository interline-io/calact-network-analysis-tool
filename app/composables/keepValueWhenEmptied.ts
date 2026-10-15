// Update handler for an `optional`, lazy numeric cat-input bound to a filter
// value. The filter inputs commit with `.lazy` (on leaving the field, Enter,
// or a step button), so each edit is one URL write and one refilter rather
// than one per keystroke. A field left empty emits undefined, and so does
// text the browser can't read as a number (such as "2."). Both leave the
// value as it is, and the field shows it again: clearing a field must not
// apply 0 as the threshold, or switch off a setting whose checkbox is derived
// from the value. Unticking the checkbox is how a filter is turned off.
export function keepValueWhenEmptied (target: { value: number | undefined }): (value: number | undefined) => void {
  return (value) => {
    if (value != null) {
      target.value = value
    }
  }
}
