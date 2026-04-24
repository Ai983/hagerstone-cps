import React from "react";
import { AppSidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex w-full bg-background overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar />
        <main className="flex-1 p-4 lg:p-6 overflow-y-auto pb-20 lg:pb-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
