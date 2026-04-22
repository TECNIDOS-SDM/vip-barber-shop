import { Suspense } from "react";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { TopNavigation } from "@/components/shared/top-navigation";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full">
        <TopNavigation />
        <div className="mx-auto w-full max-w-xl">
          <Suspense
            fallback={
              <section className="glass rounded-[2rem] p-6 sm:p-8">
                <p className="text-sm text-sand/70">Cargando acceso...</p>
              </section>
            }
          >
            <AdminLoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
