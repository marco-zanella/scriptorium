import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/theme-provider'

export function ThemeToggle() {
  const { toggleTheme } = useTheme()

  return (
    <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>
      <Sun className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  )
}
