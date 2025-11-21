"use client";
import { useState } from "react";
import { useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export default function Counter() {
  const [count, setCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const updateCount = (newCount: number) => {
    setCount(newCount);
    setLastUpdated(new Date().toLocaleString());
  };

  return (
    <Card className="w-full h-screen">
      <CardHeader>
        <CardTitle>Counter App</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center h-full bg-background">
          <div className="mb-2">Last Updated: {lastUpdated ? lastUpdated : "Never"}</div>
          <div className="text-4xl font-bold text-primary">{count}</div>
        </div>
        <Button onClick={() => updateCount(count + 1)} variant="default">
          Increment
        </Button>
        <Button onClick={() => updateCount(count - 1)} variant="secondary">
          Decrement
        </Button>
        <Button onClick={() => updateCount(0)} variant="outline">
          Reset
        </Button>
      </CardContent>
    </Card>
  );
}
