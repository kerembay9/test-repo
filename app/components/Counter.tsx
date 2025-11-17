"use client";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Counter App</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center min-h-screen bg-background">
          <div className="text-4xl font-bold text-primary">{count}</div>
        </div>
        <Button onClick={() => setCount(count + 1)} variant="default">
          Increment
        </Button>
        <Button onClick={() => setCount(count - 1)} variant="secondary">
          Decrement
        </Button>
        <Button onClick={() => setCount(0)} variant="outline">
          Reset
        </Button>
      </CardContent>
    </Card>
  );
}
