type RouteLoadingCardProps = {
  title: string;
  description: string;
};

export function RouteLoadingCard({
  title,
  description
}: RouteLoadingCardProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full">
        <div className="glass mx-auto max-w-3xl rounded-[2rem] p-8 sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-4 w-4 animate-pulse rounded-full bg-accent" />
            <div className="h-2 w-24 rounded-full bg-white/10" />
          </div>
          <div className="space-y-4">
            <div className="h-8 w-56 rounded-full bg-white/10" />
            <div className="h-4 w-full rounded-full bg-white/5" />
            <div className="h-4 w-4/5 rounded-full bg-white/5" />
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="h-24 rounded-[1.5rem] border border-white/10 bg-white/[0.03]" />
            <div className="h-24 rounded-[1.5rem] border border-white/10 bg-white/[0.03]" />
            <div className="h-24 rounded-[1.5rem] border border-white/10 bg-white/[0.03]" />
          </div>
          <p className="mt-6 text-sm text-sand/75">{description}</p>
          <p className="mt-2 text-lg font-semibold text-sand">{title}</p>
        </div>
      </div>
    </main>
  );
}
