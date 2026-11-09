import { LoginForm, PasswordForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { erro } = await searchParams;
  return (
    <main className="flex flex-1 items-center px-5 py-16">
      <div className="mx-auto w-full max-w-sm">
        <p className="text-3xl leading-tight font-bold">Felipe</p>
        <p className="mt-1 text-[15px] text-muted-foreground">Atendimento no WhatsApp</p>

        <div className="mt-8 rounded-lg border border-border bg-card p-5 shadow-[inset_0_3px_0_var(--primary)]">
          <h1 className="text-lg font-semibold">Entrar no painel</h1>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">Use seu login e senha.</p>
          {erro === "link" && (
            <p role="alert" className="mb-4 rounded-md bg-alert-soft px-3 py-2 text-sm text-alert">
              Esse link expirou ou já foi usado. Entre com a senha ou peça um novo link abaixo.
            </p>
          )}
          <PasswordForm />
        </div>

        <div className="mt-6 px-1">
          <h2 className="text-[15px] font-semibold">Sem senha?</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">Mandamos um link de acesso para o e-mail da equipe.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
