import type { ReactNode } from 'react'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh grid-rows-[auto_1fr] lg:grid-cols-[4fr_5fr] lg:grid-rows-1">
      <aside className="flex flex-col items-center justify-between gap-8 bg-primary p-4 text-primary-foreground lg:min-h-svh lg:items-start lg:p-12">
        <div className="flex w-44 max-w-full shrink-0 items-center lg:h-32 lg:w-80">
          <img
            src="/design/brand-white.svg"
            alt="VHH Fleet"
            width={300}
            height={117}
            className="h-auto w-full lg:w-72"
          />
        </div>
        <div className="relative hidden h-40 w-full shrink-0 lg:block">
          <img
            src="/design/journey.svg"
            alt=""
            className="absolute top-[30px] w-full"
          />
        </div>
        <div className="hidden space-y-6 lg:block">
          <p className="text-[32px] font-semibold leading-10">
            Every truck.
            <br />
            Every stop.
            <br />
            One clear record.
          </p>
        </div>
      </aside>
      <section
        aria-label="VHH Fleet account"
        className="flex items-start justify-center bg-muted px-4 py-6 sm:items-center sm:p-10 lg:p-12"
      >
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  )
}
