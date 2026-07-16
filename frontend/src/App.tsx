import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminPage } from './AdminPage'
import { DashboardPage } from './DashboardPage'
import { Layout } from './Layout'
import { LoginPage } from './LoginPage'
import { RequireAuth, RequireRole } from './route-guards'

function App() {
  return (
    <BrowserRouter>
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
  )
}

export default App
