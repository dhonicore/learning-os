"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type ActivityEntry = {
  qid: number;
  title: string;
  correct: boolean;
  attempt: number;
  hint_level: number | null;
  gave_up: boolean;
  timestamp: string;
};

type ActivityContextValue = {
  activityLog: ActivityEntry[];
  addEntry: (entry: ActivityEntry) => void;
  clearLog: () => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  const addEntry = useCallback((entry: ActivityEntry) => {
    setActivityLog((prev) => [...prev, entry]);
  }, []);

  const clearLog = useCallback(() => {
    setActivityLog([]);
  }, []);

  return (
    <ActivityContext.Provider value={{ activityLog, addEntry, clearLog }}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const context = useContext(ActivityContext);
  if (!context) {
    throw new Error("useActivity must be used within an ActivityProvider");
  }
  return context;
}