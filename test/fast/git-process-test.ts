import * as chai from 'chai'
const expect = chai.expect

import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'

import { GitProcess, GitError, RepositoryDoesNotExistErrorCode } from '../../lib'
import { initialize, verify } from '../helpers'

import { gitVersion } from '../../script/versions'

const temp = require('temp').track()

describe('git-process', () => {
  it('can launch git', async () => {
    const result = await GitProcess.exec([ '--version' ], __dirname)
    verify(result, r => {
      expect(r.stdout).to.contain(`git version ${gitVersion}`)
    })
  })

  describe('exitCode', () => {
    it('returns exit code when folder is empty', async () => {
      const testRepoPath = temp.mkdirSync('desktop-git-test-blank')
      const result = await GitProcess.exec([ 'show', 'HEAD' ], testRepoPath)
      verify(result, r => {
        expect(r.exitCode).to.equal(128)
      })
    })

    describe('diff', () => {
      it('returns expected error code for initial commit when creating diff', async () => {
        const testRepoPath = await initialize('blank-no-commits')

        const file = path.join(testRepoPath, 'new-file.md')
        fs.writeFileSync(file, 'this is a new file')
        const result = await GitProcess.exec([ 'diff', '--no-index', '--patch-with-raw', '-z', '--', '/dev/null', 'new-file.md' ], testRepoPath)

        verify(result, r => {
          expect(r.exitCode).to.equal(1)
          expect (r.stdout.length).to.be.greaterThan(0)
        })
      })

      it('returns expected error code for repository with history when creating diff', async () => {
        const testRepoPath = await initialize('blank-then-commit')
        const readme = path.join(testRepoPath, 'README.md')
        fs.writeFileSync(readme, 'hello world!')
        await GitProcess.exec([ 'add', '.' ], testRepoPath)

        const commit = await GitProcess.exec([ 'commit', '-F',  '-' ], testRepoPath, { stdin: 'hello world!' })
        expect(commit.exitCode).to.eq(0)

        const file = path.join(testRepoPath, 'new-file.md')
        fs.writeFileSync(file, 'this is a new file')
        const result = await GitProcess.exec([ 'diff', '--no-index', '--patch-with-raw', '-z', '--', '/dev/null', 'new-file.md' ], testRepoPath)

        verify(result, r => {
          expect(r.exitCode).to.equal(1)
          expect(r.stdout.length).to.be.greaterThan(0)
        })
      })

      it('throws error when exceeding the output range', async () => {
        const testRepoPath = temp.mkdirSync('blank-then-large-file')

        // NOTE: if we change the default buffer size in git-process
        // this test may no longer fail as expected - see https://git.io/v1dq3
        const output = crypto.randomBytes(10*1024*1024).toString('hex')
        const file = path.join(testRepoPath, 'new-file.md')
        fs.writeFileSync(file, output)

        let throws = false
        try {
          await GitProcess.exec([ 'diff', '--no-index', '--patch-with-raw', '-z', '--', '/dev/null', 'new-file.md' ], testRepoPath)
        } catch (e) {
          throws = true
        }
        expect(throws).to.be.true
      })
    })
  })

  describe('errors', () => {
    it('raises error when folder does not exist', async () => {
      const testRepoPath = path.join(temp.path(), 'desktop-does-not-exist')

      let error: Error | null = null
      try {
        await GitProcess.exec([ 'show', 'HEAD' ], testRepoPath)
      } catch (e) {
        error = e
      }

      expect(error!.message).to.equal('Unable to find path to repository on disk.')
      expect((error as any).code).to.equal(RepositoryDoesNotExistErrorCode)
    })

    it('can parse errors', () => {
      const error = GitProcess.parseError('fatal: Authentication failed')
      expect(error).to.equal(GitError.SSHAuthenticationFailed)
    })

    it('can parse bad revision errors', () => {
      const error = GitProcess.parseError("fatal: bad revision 'beta..origin/beta'")
      expect(error).to.equal(GitError.BadRevision)
    })

    it('can parse protected branch error', () => {
      const stderr = `remote: error: GH006: Protected branch update failed for refs/heads/master.
remote: error: At least one approved review is required
To https://github.com/shiftkey-tester/protected-branches.git
 ! [remote rejected] master -> master (protected branch hook declined)
error: failed to push some refs to 'https://github.com/shiftkey-tester/protected-branches.git'
`
      const error = GitProcess.parseError(stderr)
      expect(error).to.equal(GitError.ProtectedBranchRequiresReview)
    })

    it('can parse push file size error', () => {
      const stderr = `remote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.
remote: error: Trace: 2bd2bfca1605d4e0847936332f1b6c07
remote: error: See http://git.io/iEPt8g for more information.
remote: error: File some-file.mp4 is 292.85 MB; this exceeds GitHub's file size limit of 100.00 MB
To https://github.com/shiftkey/too-large-repository.git
 ! [remote rejected] master -> master (pre-receive hook declined)
error: failed to push some refs to 'https://github.com/shiftkey/too-large-repository.git'`

      const error = GitProcess.parseError(stderr)
      expect(error).to.equal(GitError.PushWithFileSizeExceedingLimit)
    })

    it('can parse branch name error', () => {
      const stderr = `remote: error: GH002: Sorry, branch or tag names consisting of 40 hex characters are not allowed.
remote: error: Invalid branch or tag name "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
To https://github.com/shiftkey/too-large-repository.git
 ! [remote rejected] aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -> aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (pre-receive hook declined)
error: failed to push some refs to 'https://github.com/shiftkey/too-large-repository.git'`

      const error = GitProcess.parseError(stderr)
      expect(error).to.equal(GitError.HexBranchNameRejected)
    })
  })
})
