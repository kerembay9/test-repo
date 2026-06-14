import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between border-b border-border bg-card/60 px-5 py-3 backdrop-blur">
      <Link href="/" className="flex items-baseline gap-1.5">
        <span className="wordmark-strong text-lg leading-none text-foreground">
          SURROUND
        </span>
        <span className="wordmark-thin text-[0.7rem] leading-none text-primary">
          SPEAKER
        </span>
      </Link>
      <div className="flex items-center gap-4 text-sm">
        <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">
          Host
        </Link>
        <Link href="/speaker" className="text-muted-foreground transition-colors hover:text-foreground">
          Join as speaker
        </Link>
      </div>
    </nav>
  );
}
