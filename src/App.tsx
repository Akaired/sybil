import { useContext, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthContext, AuthProvider } from "./contexts/AuthContext";
import { MusicPlayerProvider } from "./contexts/MusicPlayerContext";
import ScrollToTop from "./components/ScrollToTop";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import PlatformAdminRoute from "./components/PlatformAdminRoute";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import OauthGoogleCallback from "./pages/OauthGoogleCallback";
import AccountDeactivated from "./pages/AccountDeactivated";
import Welcome from "./pages/Welcome";
import JoinWorkspace from "./pages/JoinWorkspace";
import Pricing from "./pages/Pricing";
import Roadmap from "./pages/Roadmap";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Dashboard from "./pages/Dashboard";
import ChatList from "./pages/ChatList";
import CalendarPage from "./pages/Calendar";
import Sentinels from "./pages/Sentinels";
import Activity from "./pages/Activity";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminUsage from "./pages/admin/AdminUsage";
import AdminHealth from "./pages/admin/AdminHealth";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminProviders from "./pages/admin/AdminProviders";
import AdminSecrets from "./pages/admin/AdminSecrets";
import BlogList from "./pages/admin/BlogList";
import BlogEdit from "./pages/admin/BlogEdit";
import DocsList from "./pages/admin/DocsList";
import DocsEdit from "./pages/admin/DocsEdit";
import Docs from "./pages/Docs";
import DocsPage from "./pages/DocsPage";
import NotFound from "./pages/NotFound";
import Pulse from "./pages/Pulse";
import Projects from "./pages/Projects";
import Mail from "./pages/Mail";
import Tasks from "./pages/Tasks";
import Team from "./pages/Team";
import SettingsLayout from "./pages/settings/SettingsLayout";
import SettingsAccount from "./pages/settings/SettingsAccount";
import SettingsConnections from "./pages/settings/SettingsConnections";
import SettingsSkills from "./pages/settings/SettingsSkills";
import SettingsPlan from "./pages/settings/SettingsPlan";

// Gates music playback on having a real session, mounted once above the
// router so it's a single stable instance across the whole authenticated
// session — both the protected app and the public-but-also-reachable-when-
// signed-in /docs route sit below it, and neither should remount it (that
// restarts playback) just from navigating between them. Never mounts at all
// for a signed-out visitor, e.g. on the public marketing pages or /docs.
function AuthedMusicPlayer({ children }: { children: ReactNode }) {
  const { session } = useContext(AuthContext);
  if (!session) return <>{children}</>;
  return <MusicPlayerProvider>{children}</MusicPlayerProvider>;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthedMusicPlayer>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          {/* Public pages */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/oauth/google/callback" element={<OauthGoogleCallback />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/join/:code" element={<JoinWorkspace />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          {/* Public — DocsShell itself wraps signed-in visitors in the real
              app Layout (sidebar/topbar) and shows the public nav/footer to
              signed-out ones, so this must NOT also sit behind the protected
              Layout route below or a signed-in visitor gets it twice. */}
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:slug" element={<DocsPage />} />

          {/* Account-deactivated lock screen — authenticated but no sidebar/nav,
              so it's wrapped in ProtectedRoute directly rather than Layout. */}
          <Route
            path="/account-deactivated"
            element={
              <ProtectedRoute>
                <AccountDeactivated />
              </ProtectedRoute>
            }
          />

          {/* Protected workspace routes */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chats" element={<ChatList />} />
            <Route path="/pulse" element={<Pulse />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/sentinels" element={<Sentinels />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="/settings/account" replace />} />
              <Route path="account" element={<SettingsAccount />} />
              <Route path="connections" element={<SettingsConnections />} />
              <Route path="skills" element={<SettingsSkills />} />
              <Route path="plan" element={<SettingsPlan />} />
            </Route>
            <Route path="/team" element={<Team />} />
            <Route
              path="/admin"
              element={
                <PlatformAdminRoute>
                  <AdminLayout />
                </PlatformAdminRoute>
              }
            >
              <Route index element={<Navigate to="/admin/overview" replace />} />
              <Route path="overview" element={<AdminOverview />} />
              <Route path="usage" element={<AdminUsage />} />
              <Route path="health" element={<AdminHealth />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="providers" element={<AdminProviders />} />
              <Route path="secrets" element={<AdminSecrets />} />
              <Route path="blog" element={<BlogList />} />
              <Route path="blog/:id" element={<BlogEdit />} />
              <Route path="docs" element={<DocsList />} />
              <Route path="docs/:id" element={<DocsEdit />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </AuthedMusicPlayer>
    </AuthProvider>
  );
}
