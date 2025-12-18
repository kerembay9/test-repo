import Link from 'next/link';

export default function Navbar() {
  return (
    <nav style={{ padding: '1rem', background: '#f0f0f0' }}>
      <Link href="/">Home</Link> | 
      <Link href="/about">About</Link> |
      <Link href="/contact">Contact</Link>
    </nav>
  );
}