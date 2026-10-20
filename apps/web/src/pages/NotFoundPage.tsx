import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 text-center">
      <h1 className="text-4xl font-bold text-navy-700">404</h1>
      <p className="text-slate-500">Página não encontrada.</p>
      <Link to="/" className="font-medium text-navy-600 hover:underline">
        Voltar para o início
      </Link>
    </div>
  );
}
