import Link from 'next/link'

export default function NotFound() {
  return (
    <main className='relative min-h-screen overflow-hidden bg-slate-100'>
      <div
        className='absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at 12% 18%, rgba(59,130,246,0.15) 0%, transparent 42%), radial-gradient(circle at 86% 12%, rgba(14,165,233,0.14) 0%, transparent 40%), linear-gradient(180deg, #020617 0%, #0f172a 34%, #1e293b 52%, #94a3b8 78%, #f1f5f9 100%)',
        }}
      />

      <div
        className='pointer-events-none absolute inset-0'
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage:
            'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.12) 100%)',
        }}
      />

      <section className='relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 py-20 text-center'>
        <p
          className='mb-5 text-xs font-semibold tracking-[0.32em] text-sky-200'
          style={{
            fontFamily: 'Space Grotesk, Avenir Next, Segoe UI, sans-serif',
          }}
        >
          INTERSECT Hub
        </p>

        <h1
          className='mb-5 text-6xl font-black leading-none text-white sm:text-7xl md:text-8xl'
          style={{
            fontFamily: 'Space Grotesk, Avenir Next, Segoe UI, sans-serif',
            textShadow: '0 10px 34px rgba(2, 132, 199, 0.35)',
          }}
        >
          404
        </h1>

        <h2
          className='mb-4 max-w-2xl text-balance text-2xl font-bold text-slate-50 sm:text-3xl'
          style={{
            fontFamily: 'Space Grotesk, Avenir Next, Segoe UI, sans-serif',
          }}
        >
          This page was not found.
        </h2>

        <p className='mb-10 max-w-xl text-base text-slate-200 sm:text-lg'>
          The page you requested does not exist or may have moved. Use one of
          these routes to continue to the homepage or launch iHub.
        </p>

        <div className='flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center'>
          <Link
            href='/'
            className='rounded-xl bg-sky-400 px-6 py-3 text-center text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-sky-300'
          >
            Return to Homepage
          </Link>
          <a
            href='/hub'
            className='rounded-xl border border-slate-300/45 bg-white/10 px-6 py-3 text-center text-sm font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/20'
          >
            Launch iHub
          </a>
        </div>

        <div className='mt-16 border-t border-slate-400/20 pt-10'>
          <p className='text-sm text-slate-300'>
            Still need help? Contact us at{' '}
            <a
              href='mailto:ihub-support@ornl.gov'
              className='font-semibold text-sky-300 hover:text-sky-200 transition'
            >
              ihub-support@ornl.gov
            </a>
          </p>
        </div>
      </section>
    </main>
  )
}
