/**
 * The second half of "never a silent freeze" (see NavProgress.tsx for the
 * first). This is what stands in for a screen between the server beginning to
 * answer and the screen's own data arriving.
 *
 * It sits at the `(app)` boundary rather than on each screen because the shell
 * around it — the rail, both headers, the two act buttons — is a shared layout
 * and is NOT re-rendered on a navigation between screens under it. Only this
 * part is replaced, so one skeleton is honest about every screen behind it: a
 * heading, then rows. Anything more specific would have to be wrong on most of
 * them.
 *
 * Deliberately not announced. The progress bar in NavProgress.tsx already
 * announces a navigation, and it is live on exactly the taps that reach here;
 * a second polite region saying the same thing at the same moment is read out
 * twice. On a typed URL or a reload — where the bar has no click to know about
 * — the browser's own loading indicator is the report, and the arriving page
 * announces itself. So these are decorative shapes and nothing else.
 */
export default function AppLoading() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      {/* Heading */}
      <div className="ir-skeleton h-8 w-1/2 max-w-xs" />

      {/* Rows. Three is enough to read as "a list is coming" without the
          skeleton itself becoming a long page to scroll. */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="ir-card flex flex-col gap-3 p-4">
            <div className="ir-skeleton h-5 w-2/3 max-w-sm" />
            <div className="ir-skeleton h-4 w-1/3 max-w-[12rem]" />
          </div>
        ))}
      </div>
    </div>
  )
}
