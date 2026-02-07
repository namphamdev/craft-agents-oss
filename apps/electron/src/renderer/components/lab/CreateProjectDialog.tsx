/**
 * CreateProjectDialog
 *
 * Dialog for creating a new Lab project.
 * Follows the RenameDialog pattern with additional fields.
 */

import { useState, useEffect, useRef } from 'react'
import { FolderOpen, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useRegisterModal } from '@/context/ModalContext'
import type { CreateProjectInput } from '@craft-agent/shared/lab/types'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CreateProjectInput) => void
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onSubmit,
}: CreateProjectDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [goalsText, setGoalsText] = useState('')
  const [workingDirectory, setWorkingDirectory] = useState<string | undefined>(undefined)

  useRegisterModal(open, () => onOpenChange(false))

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setGoalsText('')
      setWorkingDirectory(undefined)
      const timer = setTimeout(() => nameRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleSubmit = () => {
    if (!name.trim()) return

    const goals = goalsText
      .split('\n')
      .map(g => g.trim())
      .filter(Boolean)

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      goals,
      workingDirectory,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[480px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>New Lab Project</DialogTitle>
          <DialogDescription>
            Create a project to orchestrate a team of AI personas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Project Name
            </label>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., User Authentication System"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
              }}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
            />
          </div>

          {/* Goals */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Goals (one per line, optional)
            </label>
            <textarea
              className="w-full min-h-[60px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              value={goalsText}
              onChange={(e) => setGoalsText(e.target.value)}
              placeholder={"Secure login and registration\nOAuth integration\nRole-based access control"}
            />
          </div>

          {/* Working Directory */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Working Directory (optional)
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-md border border-input px-3 py-2 text-sm">
                {workingDirectory ? (
                  <span className="truncate block">{workingDirectory}</span>
                ) : (
                  <span className="text-muted-foreground">No folder selected</span>
                )}
              </div>
              {workingDirectory && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-8 w-8"
                  onClick={() => setWorkingDirectory(undefined)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={async () => {
                  const path = await window.electronAPI?.openFolderDialog()
                  if (path) setWorkingDirectory(path)
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The folder where agents will read and write files during pipeline execution.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
