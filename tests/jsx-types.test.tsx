/** @jsxImportSource ../src */

const intrinsic = (
  <div
    id="root"
    padding={12}
    frame={{ maxWidth: 'infinity', alignment: 'center' }}
    background="Canvas"
  >
    Rui
  </div>
)

// @ts-expect-error modifier values use Rui's Length type, not arbitrary objects
const invalid = <div padding={{ value: 12 }} />

export { intrinsic, invalid }
