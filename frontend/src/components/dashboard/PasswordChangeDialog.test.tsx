import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api'
import { PasswordChangeCard } from './PasswordChangeDialog'

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api')
  return {
    ...actual,
    changePassword: vi.fn(),
  }
})

const api = await import('../../api')

beforeEach(() => {
  vi.mocked(api.changePassword).mockReset()
})

async function openDialog() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  return user
}

describe('PasswordChangeCard', () => {
  it('submits the current and new password', async () => {
    vi.mocked(api.changePassword).mockResolvedValue(undefined)
    render(<PasswordChangeCard />)
    const user = await openDialog()

    await user.type(screen.getByLabelText('Current password'), 'old-password')
    await user.type(screen.getByLabelText('New password'), 'new-password-123')
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-123')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith('old-password', 'new-password-123'),
    )
  })

  it('blocks submission client-side when the confirmation does not match', async () => {
    render(<PasswordChangeCard />)
    const user = await openDialog()

    await user.type(screen.getByLabelText('Current password'), 'old-password')
    await user.type(screen.getByLabelText('New password'), 'new-password-123')
    await user.type(screen.getByLabelText('Confirm new password'), 'something-else')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('New password and confirmation do not match')).toBeInTheDocument()
    expect(api.changePassword).not.toHaveBeenCalled()
  })

  it('surfaces an ApiError message inline', async () => {
    vi.mocked(api.changePassword).mockRejectedValue(
      new ApiError(400, 'Current password is incorrect'),
    )
    render(<PasswordChangeCard />)
    const user = await openDialog()

    await user.type(screen.getByLabelText('Current password'), 'wrong-password')
    await user.type(screen.getByLabelText('New password'), 'new-password-123')
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-123')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
  })
})
