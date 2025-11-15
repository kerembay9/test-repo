'use client';
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <div id="counter">{count}</div>
      <Button onClick={() => setCount(count + 1)} variant="default">Increment</Button>
      <Button onClick={() => setCount(count - 1)} variant="secondary">Decrement</Button>
      <Button onClick={() => setCount(0)} variant="outline">Reset</Button>
    </div>
  );
}