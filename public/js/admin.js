// Global State Management
const authState = {
  isDriveConnected: false,
  isTokenValid: false,
  lastTokenCheck: 0,
  activeOperations: 0,
  MAX_CONCURRENT_OPS: 1
};

let socket = null;

// WebSocket Initialization
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
      console.log('WebSocket connected');
      checkDriveStatus(true);
  };

  socket.onmessage = (event) => {
      try {
          const data = JSON.parse(event.data);
          if (data.type === 'videos_updated') {
              updateVideoListUI(data.videos);
          }
          if (data.type === 'session_update') {
              handleSessionUpdate(data);
          }
          if (data.type === 'upload_progress') {
              updateUploadProgress(data.progress);
          }
      } catch (error) {
          console.error('WebSocket message error:', error);
      }
  };

  socket.onclose = () => {
      console.log('WebSocket disconnected');
      setTimeout(initWebSocket, 5000);
  };

  socket.onerror = (error) => {
      console.error('WebSocket error:', error);
  };
}

// Session Management
function handleSessionUpdate(data) {
  if (data.sessionExpired) {
      authState.isTokenValid = false;
      showSessionAlert('Session expired. Please reconnect Google Drive.', 'danger');
  } else if (data.tokenRefreshed) {
      authState.isTokenValid = true;
      hideSessionAlert();
  }
}

// Connection Management
async function checkDriveStatus(force = false) {
  try {
      const response = await fetch(`/auth/status?force=${force}&t=${Date.now()}`);
      if (!response.ok) throw new Error("Network error");
      
      const data = await response.json();
      authState.isDriveConnected = data.connected;
      authState.isTokenValid = data.connected;
      authState.lastTokenCheck = Date.now();
      
      updateConnectionUI(data.connected);
      return data.connected;
  } catch (error) {
      console.error("Status check failed:", error);
      authState.isTokenValid = false;
      updateConnectionUI(false);
      throw error;
  }
}

// Operation Handler with Concurrency Control
async function handleDriveOperation(operation) {
  if (authState.activeOperations >= authState.MAX_CONCURRENT_OPS) {
      throw new Error("Please wait until current operation completes");
  }

  authState.activeOperations++;
  
  try {
      await verifyConnection();
      const result = await operation();
      return result;
  } catch (error) {
      console.error('Operation error:', error);
      
      if (error.message.includes('invalid_grant') || 
          error.message.includes('token_expired')) {
          await checkDriveStatus(true);
          if (!authState.isTokenValid) {
              throw new Error('Session expired. Please reconnect Google Drive.');
          }
          // Retry once with fresh token
          return await operation();
      }
      throw error;
  } finally {
      authState.activeOperations--;
  }
}

// Upload Handler with Progress Tracking
document.getElementById('upload-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('video-upload');
  const file = fileInput.files[0];
  
  if (!file) {
    alert('Please select a video file');
    return;
  }

  // Show progress UI
  document.getElementById('progress-container').style.display = 'block';
  const progressBar = document.getElementById('upload-progress');
  const progressText = document.getElementById('progress-text');

  try {
    await handleDriveOperation(async () => {
      const formData = new FormData();
      formData.append('video', file);

      const response = await fetch('/upload', {
        method: 'POST',
        body: formData
      });

      // Track progress via WebSocket
      socket.send(JSON.stringify({
        type: 'upload_start',
        filename: file.name,
        size: file.size
      }));

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = await response.json();
      showUploadResult(result.link);
      return result;
    });
  } catch (error) {
    console.error('Upload failed:', error);
    showError(`Upload failed: ${error.message}`);
  } finally {
    fileInput.value = ''; // Reset file input
    progressBar.value = 0;
    progressText.textContent = '0%';
    document.getElementById('progress-container').style.display = 'none';
  }
});

// Delete Handler
async function deleteVideo(videoId, videoNumber) {
  if (!confirm(`Delete Video ${videoNumber}?`)) return;
  
  const btn = document.querySelector(`.delete-btn[data-id="${videoId}"]`);
  try {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>';
      btn.disabled = true;
      
      await handleDriveOperation(async () => {
          const response = await fetch(`/delete-video/${videoId}`, {
              method: 'DELETE'
          });
          await handleResponse(response);
      });
  } catch (error) {
      showError(`Delete failed: ${error.message}`);
  } finally {
      btn.innerHTML = '<i class="fas fa-trash me-1"></i>Delete';
      btn.disabled = false;
  }
}

// Helper Functions
function updateUploadProgress(percent) {
  const progressBar = document.getElementById('upload-progress');
  const progressText = document.getElementById('progress-text');
  progressBar.value = percent;
  progressText.textContent = `${percent}%`;
}

async function handleResponse(response) {
  if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP error ${response.status}`);
  }
  return response.json();
}

function setButtonState(btn, isLoading, text) {
  const spinner = btn.querySelector('.spinner-border') || 
                 document.createElement('span');
  
  if (isLoading) {
      spinner.className = 'spinner-border spinner-border-sm';
      spinner.style.marginLeft = '5px';
      btn.innerHTML = text;
      btn.appendChild(spinner);
      btn.disabled = true;
  } else {
      btn.innerHTML = text;
      btn.disabled = false;
  }
}

function showUploadResult(link) {
  // Implement your success notification UI here
  alert(`Upload successful! Video available at: ${link}`);
}

function showError(message) {
  // Implement your error notification UI here
  alert(message);
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  checkDriveStatus(true);
  fetchVideos();
  
  setInterval(() => {
      if (authState.activeOperations === 0) {
          checkDriveStatus();
      }
  }, 120000);
});
