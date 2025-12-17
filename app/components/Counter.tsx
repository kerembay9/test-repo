"use client";
import { useState, useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export default function Counter() {
  const [count, setCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState("");

  const updateCount = (newCount: number) => {
    setCount(newCount);
  };

  useEffect(() => {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    setLastUpdated(timeString);
  }, [count]);

  return (
    <Card className="w-full h-screen">
      <CardHeader>
        <CardTitle>Counter App</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center h-64 w-full bg-background">
          <div className="text-4xl font-bold text-primary">{count}</div>
        </div>
        <div className="flex space-x-2 mb-4">
          <Button onClick={() => updateCount(count + 1)}>Increment</Button>
        </div>
        <div className="flex space-x-2">
          <Button onClick={() => updateCount(count - 1)}>Decrement</Button>
          <Button onClick={() => updateCount(0)} className="ml-2">Reset</Button>
        </div>
      </CardContent>
      <div className="mt-4 text-center">Last Updated: {lastUpdated}</div>
    </Card>
  );
}