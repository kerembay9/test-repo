import Link from 'next/link';

export default function Navbar() {
  return (
    <nav style={{ padding: '1rem', background: '#f0f0f0' }}>
      <Link href="/">Host</Link> |{" "}
      <Link href="/speaker">Join as speaker</Link>
    </nav>
  );
}