import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ALL_ROLES,
  ApiError,
  assignRole,
  createUser,
  deleteUser,
  listUsers,
  revokeRole,
  updateUser,
  type UserOut,
} from './api'
import { useAuth } from './auth-provider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<UserOut[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<UserOut | null>(null)
  const canGrantManageUsers = currentUser?.is_superuser ?? false

  async function loadUsers() {
    try {
      setUsers(await listUsers())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users')
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return users
    return users.filter(
      (u) => u.username.toLowerCase().includes(query) || u.email.toLowerCase().includes(query),
    )
  }, [users, search])

  async function handleToggleActive(target: UserOut, isActive: boolean) {
    await updateUser(target.id, { is_active: isActive })
    await loadUsers()
  }

  async function handleToggleRole(target: UserOut, role: string, hasRole: boolean) {
    if (hasRole) {
      await revokeRole(target.id, role)
    } else {
      await assignRole(target.id, role)
    }
    await loadUsers()
  }

  async function handleDelete(target: UserOut) {
    await deleteUser(target.id)
    await loadUsers()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl leading-snug font-medium">Users</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by username or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-64"
          />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button>New user</Button>} />
            <DialogContent>
              <UserForm
                canGrantManageUsers={canGrantManageUsers}
                onSubmit={async (values) => {
                  await createUser(values.username, values.email, values.password, values.roles)
                  setCreateOpen(false)
                  await loadUsers()
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUsers.map((rowUser) => (
            <TableRow key={rowUser.id}>
              <TableCell>{rowUser.username}</TableCell>
              <TableCell>{rowUser.email}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {ALL_ROLES.filter((role) => role !== 'manage_users' || canGrantManageUsers).map(
                    (role) => {
                      const hasRole = rowUser.roles.includes(role)
                      return (
                        <Badge
                          key={role}
                          variant={hasRole ? 'default' : 'outline'}
                          className="cursor-pointer select-none"
                          onClick={() => handleToggleRole(rowUser, role, hasRole)}
                        >
                          {role}
                        </Badge>
                      )
                    },
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Switch
                  checked={rowUser.is_active}
                  onCheckedChange={(checked) => handleToggleActive(rowUser, checked)}
                />
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Dialog
                    open={editing?.id === rowUser.id}
                    onOpenChange={(open) => setEditing(open ? rowUser : null)}
                  >
                    <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
                    <DialogContent>
                      <UserForm
                        canGrantManageUsers={canGrantManageUsers}
                        initial={rowUser}
                        onSubmit={async (values) => {
                          await updateUser(rowUser.id, {
                            username: values.username,
                            email: values.email,
                            ...(values.password ? { password: values.password } : {}),
                          })
                          setEditing(null)
                          await loadUsers()
                        }}
                      />
                    </DialogContent>
                  </Dialog>

                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button variant="destructive" size="sm">
                          Delete
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {rowUser.username}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the account. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                        <AlertDialogAction variant="destructive" onClick={() => handleDelete(rowUser)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

interface UserFormValues {
  username: string
  email: string
  password: string
  roles: string[]
}

function UserForm({
  canGrantManageUsers,
  initial,
  onSubmit,
}: {
  canGrantManageUsers: boolean
  initial?: UserOut
  onSubmit: (values: UserFormValues) => Promise<void>
}) {
  const isEdit = initial !== undefined
  const [username, setUsername] = useState(initial?.username ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? [])
  const [error, setError] = useState<string | null>(null)

  function toggleRole(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit({ username, email, password, roles })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit user' : 'Create user'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="form-username">Username</Label>
        <Input
          id="form-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="form-email">Email</Label>
        <Input
          id="form-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="form-password">{isEdit ? 'New password (optional)' : 'Password'}</Label>
        <Input
          id="form-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required={!isEdit}
          placeholder={isEdit ? 'Leave blank to keep the current password' : undefined}
        />
      </div>
      {!isEdit && (
        <div className="space-y-2">
          <Label>Roles</Label>
          {ALL_ROLES.filter((role) => role !== 'manage_users' || canGrantManageUsers).map(
            (role) => (
              <div key={role} className="flex items-center gap-2">
                <Checkbox
                  id={`form-role-${role}`}
                  checked={roles.includes(role)}
                  onCheckedChange={() => toggleRole(role)}
                />
                <Label htmlFor={`form-role-${role}`} className="font-normal">
                  {role}
                </Label>
              </div>
            ),
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit">{isEdit ? 'Save' : 'Create'}</Button>
      </DialogFooter>
    </form>
  )
}
