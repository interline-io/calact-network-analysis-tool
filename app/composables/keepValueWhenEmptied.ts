// Update handler for an `optional` numeric cat-input bound to a filter value.
// An emptied field emits undefined, and so does text the browser can't read
// as a number yet (such as "2."). Both leave the value as it is: clearing a
// field to retype it must not apply 0 as the threshold, or switch off a
// setting whose checkbox is derived from the value and so lock the field
// mid-edit. Unticking the checkbox is how a filter is turned off.
export function keepValueWhenEmptied (target: { value: number | undefined }): (value: number | undefined) => void {
  return (value) => {
    if (value != null) {
      target.value = value
    }
  }
}
