import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { Logo } from "@/components/shared/logo";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
    switch?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const nextPath = resolvedSearchParams.next || "/admin-vip";
  const isBarberSwitch = resolvedSearchParams.switch === "barbero";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-6 flex justify-center">
            <Logo title="INICIAR SESION" />
          </div>
          <AdminLoginForm
            nextPath={nextPath}
            isBarberSwitch={isBarberSwitch}
          />
        </div>
      </div>
    </main>
  );
}
