const { spawn } = require('child_process');

const validateGitUrl = (url) => {
  if (!url) return false;
  
  const patterns = [
    /^https?:\/\/github\.com\/[\w\-]+\/[\w\-\.]+(\/)?$/,
    /^https?:\/\/gitlab\.com\/[\w\-]+\/[\w\-\.]+(\/)?$/,
    /^https?:\/\/bitbucket\.org\/[\w\-]+\/[\w\-\.]+(\/)?$/,
    /^https?:\/\/github\.com\/[\w\-]+\/[\w\-\.]+\.git$/,
    /^https?:\/\/gitlab\.com\/[\w\-]+\/[\w\-\.]+\.git$/,
    /^https?:\/\/bitbucket\.org\/[\w\-]+\/[\w\-\.]+\.git$/
  ];
  
  return patterns.some(pattern => pattern.test(url));
};

const cloneRepository = (repoUrl, targetDir) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['clone', '--depth', '1', repoUrl, targetDir]);
    
    let output = '';
    let errorOutput = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        reject(new Error(errorOutput || `Git clone terminó con código ${code}`));
      }
    });
    
    proc.on('error', (error) => {
      reject(new Error(`Error al ejecutar git: ${error.message}`));
    });
  });
};

const pullRepository = (targetDir) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['pull', 'origin', 'main'], { cwd: targetDir });
    
    let output = '';
    let errorOutput = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        const procFallback = spawn('git', ['pull', 'origin', 'master'], { cwd: targetDir });
        
        procFallback.on('close', (fallbackCode) => {
          if (fallbackCode === 0) {
            resolve({ success: true, output: 'Pulled from master branch' });
          } else {
            reject(new Error(errorOutput || `Git pull terminó con código ${code}`));
          }
        });
      }
    });
    
    proc.on('error', (error) => {
      reject(new Error(`Error al ejecutar git: ${error.message}`));
    });
  });
};

const getRepoInfo = (repoUrl) => {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.split('/').filter(p => p);
    
    return {
      platform: url.hostname.replace('.com', '').replace('.org', ''),
      owner: parts[0] || 'unknown',
      repo: (parts[1] || 'unknown').replace('.git', ''),
      fullUrl: repoUrl
    };
  } catch (error) {
    return null;
  }
};

module.exports = {
  validateGitUrl,
  cloneRepository,
  pullRepository,
  getRepoInfo
};