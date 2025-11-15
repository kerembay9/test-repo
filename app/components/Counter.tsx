'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <div className="flex flex-col items-center justify-center min-h-screen bg-background"><div className="text-4xl font-bold text-primary">{count}</div></div>
      <Button onClick={() => setCount(count + 1)} variant="default">Increment</Button>
      <Button onClick={() => setCount(count - 1)} variant="secondary">Decrement</Button>
      <Button onClick={() => setCount(0)} variant="outline">Reset</Button>
    </div>
  );
}