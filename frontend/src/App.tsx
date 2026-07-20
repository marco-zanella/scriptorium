import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminPage } from './AdminPage'
import { DashboardPage } from './DashboardPage'
import { EvalCompareResultsPage } from './EvalCompareResultsPage'
import { EvalResultCasePage } from './EvalResultCasePage'
import { EvalResultPage } from './EvalResultPage'
import { EvalTestCasesPage } from './EvalTestCasesPage'
import { EvalTestCollectionResultsPage } from './EvalTestCollectionResultsPage'
import { EvalTestCollectionsPage } from './EvalTestCollectionsPage'
import { EvalTestCollectionTestCasesPage } from './EvalTestCollectionTestCasesPage'
import { Layout } from './Layout'
import { LoginPage } from './LoginPage'
import { RagConversationPage } from './RagConversationPage'
import { RagEmptyState } from './RagEmptyState'
import { RagPage } from './RagPage'
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
            <Route
              path="eval/test-cases"
              element={
                <RequireRole role="run_experiments">
                  <EvalTestCasesPage />
                </RequireRole>
              }
            />
            <Route
              path="eval/collections"
              element={
                <RequireRole role="run_experiments">
                  <EvalTestCollectionsPage />
                </RequireRole>
              }
            />
            <Route
              path="eval/collections/:id/test-cases"
              element={
                <RequireRole role="run_experiments">
                  <EvalTestCollectionTestCasesPage />
                </RequireRole>
              }
            />
            <Route
              path="eval/collections/:id/results"
              element={
                <RequireRole role="run_experiments">
                  <EvalTestCollectionResultsPage />
                </RequireRole>
              }
            />
            <Route
              path="eval/collections/:id/compare"
              element={
                <RequireRole role="run_experiments">
                  <EvalCompareResultsPage />
                </RequireRole>
              }
            />
            <Route
              path="eval/results/:id"
              element={
                <RequireRole role="run_experiments">
                  <EvalResultPage />
                </RequireRole>
              }
            />
            <Route
              path="eval/results/:resultCollectionId/cases/:caseId"
              element={
                <RequireRole role="run_experiments">
                  <EvalResultCasePage />
                </RequireRole>
              }
            />
            <Route
              path="rag"
              element={
                <RequireRole role="use_rag">
                  <RagPage />
                </RequireRole>
              }
            >
              <Route index element={<RagEmptyState />} />
              <Route path=":id" element={<RagConversationPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}

export default App
