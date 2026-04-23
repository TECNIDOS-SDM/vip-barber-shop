export default function GestionEquipoLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded-xl bg-white/10" />
          <div className="h-12 w-80 rounded-xl bg-white/10" />
          <div className="h-4 w-44 rounded-xl bg-white/10" />
        </div>
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-36 rounded-xl bg-white/10" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 rounded-2xl bg-white/10"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-40 rounded-xl bg-white/10" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-24 rounded-2xl bg-white/10"
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
