import { spawn as spawnChildProcess, exec as execCommand } from 'child_process'

import store from './store'

const sshfsWinPath = store.state.Settings.settings.sshfsBinary
const processMonitoringInterval = 5000

let processes = []

function spawn (conn) {
  return new Promise((resolve, reject) => {
    const cmdArgs = [
      'cmd',
      `${conn.user}@${conn.host}:${conn.folder}`,
      conn.mountPoint,
      `-p${conn.port}`,
      '-oidmap=user',
      '-ouid=-1',
      '-ogid=-1',
      '-oumask=000',
      '-ocreate_umask=000',
      `-ovolname=${conn.name}`,
      '-omax_readahead=1GB',
      '-oStrictHostKeyChecking=no',
      '-oUserKnownHostsFile=/dev/null',
      '-oallow_other',
      '-olarge_read',
      '-okernel_cache'
    ]

    if (conn.authType === 'password') {
      cmdArgs.push('-oPreferredAuthentications=password')
      cmdArgs.push('-opassword_stdin')
    }

    if (conn.authType === 'key-file') {
      cmdArgs.push('-oPreferredAuthentications=publickey')
      cmdArgs.push(`-oIdentityFile="${conn.keyFile.replace(/\\/g, '/')}"`)
    }

    const childProcess = spawnChildProcess(sshfsWinPath, cmdArgs)

    if (conn.authType === 'password') {
      childProcess.stdin.write(conn.password + '\n')
    }

    let intermmediatePid = 0

    getChildSSHFSWinInstancePid(childProcess.pid).then(pid => {
      intermmediatePid = pid
    })

    childProcess.stderr.on('data', data => {
      reject(data.toString())
    })

    const process = {
      pid: 0,
      events: {},
      checkAliveTimer: null,

      on (event, callback) {
        this.events[event] = callback
      },

      terminate () {
        return new Promise(resolve => {
          killProcessTree(this.pid).then(() => {
            clearInterval(this.checkAliveTimer)

            processes = processes.filter(a => a.pid !== this.pid)

            if (this.events.exit) {
              this.events.exit()
            }

            resolve()
          })
        })
      }
    }

    childProcess.on('close', exitCode => {
      if (exitCode === 0) {
        getChildSSHFSWinInstancePid(intermmediatePid).then(pid => {
          process.pid = pid

          process.checkAliveTimer = setInterval(() => {
            checkIfProcessIsAlive(pid).then(result => {
              if (!result) {
                if (process.events.notFound) {
                  process.events.notFound()
                }

                clearInterval(process.checkAliveTimer)
              }
            })
          }, processMonitoringInterval)

          processes.push(process)

          resolve(process)
        })
      }
    })
  })
}

function terminateAllChildProcesses () {
  const killingQueue = []

  processes.forEach(process => {
    killingQueue.push(process.terminate())
  })

  return Promise.all(killingQueue)
}

function getChildSSHFSWinInstancePid (parentPid) {
  return new Promise((resolve, reject) => {
    execCommand(`wmic process where '(name="sshfs.exe" and parentprocessid=${parentPid})' get processid /value`, (err, stdout) => {
      if (!err) {
        resolve(parseInt(stdout.toString().trim().split('=')[1]))
      } else {
        reject(new Error('Process not found'))
      }
    })
  })
}

function killProcessTree (pid) {
  return new Promise(resolve => {
    execCommand(`taskkill /PID ${pid} /T /F`, err => {
      if (!err) {
        resolve()
      } else {
        resolve()
        console.log(err)
      }
    })
  })
}

function checkIfProcessIsAlive (pid) {
  return new Promise(resolve => {
    execCommand(`tasklist /FI "PID eq ${pid}"`, (err, stdout) => {
      if (!err) {
        if (stdout.toString().includes(pid)) {
          resolve(true)
        } else {
          resolve(false)
        }
      } else {
        resolve(false)
      }
    })
  })
}

export default {
  spawn,
  terminateAllChildProcesses
}
