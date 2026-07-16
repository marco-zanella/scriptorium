import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminPage } from './AdminPage'
import { DashboardPage } from './DashboardPage'
import { Layout } from './Layout'
import { LoginPage } from './LoginPage'
import { RequireAuth, RequireRole } from './route-guards'
import { SearchConfigurationsPage } from './SearchConfigurationsPage'
import { SearchPage } from './SearchPage'
import { TooltipProvider } from '@/components/ui/tooltip'

function App() {
  return (
    <TooltipProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route
              path="search"
              element={
                <RequireRole role="use_search_engine">
                  <SearchPage />
                </RequireRole>
              }
            />
            <Route
              path="search/configurations"
              element={
                <RequireRole role="use_search_engine">
                  <SearchConfigurationsPage />
                </RequireRole>
              }
            />
            <Route
              path="admin"
              element={
                <RequireRole role="manage_users">
                  <AdminPage />
                </RequireRole>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}

export default App
