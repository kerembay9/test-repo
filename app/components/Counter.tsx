"use client";
import { useState } from "react";
import { useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export default function Counter() {
  const [count, setCount] = useState(0);

  const updateCount = (newCount: number) => {
    setCount(newCount);
  };

  useEffect(() => {
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  setLastUpdated(timeString);
}, [count]);

useEffect(() => {
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  setLastUpdated(timeString);
}, [count]);

useEffect(() => {
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  setLastUpdated(timeString);
}, [count]);

return (
    <Card className="w-full h-screen">
    
 {/* Update the last updated timestamp dynamically */}
 useEffect(() => {
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  setLastUpdated(timeString);
}, [count]);
      <CardHeader>
        <CardTitle>Counter App</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center h-full bg-background">
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
      <div className="mt-4 text-center">Last Updated: {lastUpdated}</div>
    </Card>
    </Card>
  );
}
