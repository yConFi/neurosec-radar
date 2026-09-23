import { LoginForm } from "./login-form"

export const metadata = { title: "Entrar · NeuroSec Radar" }

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center font-mono text-lg font-bold">
          <span className="text-red-600">●</span> NeuroSec Radar
        </h1>
        <LoginForm />
      </div>
    </main>
  )
}
