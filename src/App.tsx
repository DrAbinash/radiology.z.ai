import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { readRadSession, clearRadSession, type RadSession } from "@/lib/session";
import Login from "@/pages/Login";
import Worklist from "@/pages/Worklist";
import Cockpit from "@/pages/Cockpit";
import Reports from "@/pages/Reports";
import PrintSettingsPage from "@/pages/PrintSettings";

type View =
  | { name: "worklist" }
  | { name: "cockpit"; uid: string }
  | { name: "reports" }
  | { name: "settings" };

export default function App() {
  const [session, setSession] = useState<RadSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: "worklist" });

  useEffect(() => {
    const stored = readRadSession();
    if (!stored) {
      setChecking(false);
      return;
    }
    api<{ user: RadSession["user"] }>("/api/auth/me")
      .then((res) => setSession({ token: stored.token, user: res.user }))
      .catch(() => {
        clearRadSession();
        setSession(null);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Connecting…
      </div>
    );
  }

  if (!session) return <Login onAuthed={(s) => setSession(s)} />;

  if (view.name === "cockpit") {
    return <Cockpit accession={view.uid} user={session.user} onBack={() => setView({ name: "worklist" })} />;
  }

  if (view.name === "settings") {
    return <PrintSettingsPage user={session.user} onBack={() => setView({ name: "worklist" })} />;
  }

  if (view.name === "reports") {
    return (
      <Reports
        user={session.user}
        onBack={() => setView({ name: "worklist" })}
        onOpenStudy={(uid) => setView({ name: "cockpit", uid })}
      />
    );
  }

  return (
    <Worklist
      user={session.user}
      onOpenStudy={(uid) => setView({ name: "cockpit", uid })}
      onOpenSettings={() => setView({ name: "settings" })}
      onOpenReports={() => setView({ name: "reports" })}
    />
  );
}
