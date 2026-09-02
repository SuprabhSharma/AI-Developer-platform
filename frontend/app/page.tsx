import Link from "next/link";
import Icon from "@/components/Icon";

export default function HomePage() {
  return (
    <main className="auth-shell"><section className="auth-card"><span className="auth-brand"><span className="brand-mark"><Icon name="github" size={17} /></span> Forge</span><p className="page-kicker">A focused code workspace</p><h1>Build with a little more room to think.</h1><p>Projects, files, and a helpful coding companion in one calm, keyboard-friendly place.</p><div className="flex gap-2"><Link href="/login" className="primary-button flex-1">Sign in <Icon name="arrow-right" size={15} /></Link><Link href="/register" className="secondary-button flex-1">Create account</Link></div></section></main>
  );
}
