/** Selected verification tests; the optional free-text test is additional. */
export const MIN_TESTS = 3
export const MAX_TESTS = 20

export function canSubmitSelection(count: number): boolean {
  return Number.isInteger(count) && count >= MIN_TESTS && count <= MAX_TESTS
}

export function selectionMessage(count: number): string {
  return `${count} selected · ${MIN_TESTS} tests minimum`
}
