async function loadVideo() {
  const urlParams = new URLSearchParams(window.location.search);
  const videoParam = urlParams.get('video');
  const container = document.getElementById('videoContainer');

  if (!videoParam) {
    container.innerHTML = '<div class="error">❌ Please specify a video</div>';
    return;
  }

  try {
    const response = await fetch(`/get-video/${videoParam}`);
    const result = await response.json();

    if (result.success) {
      displayVideo(result.videoId);
    } else {
      throw new Error(result.error || 'Video not found');
    }
  } catch (error) {
    container.innerHTML = `
      <div class="error">
        <p>❌ ${error.message}</p>
        ${videoParam.length > 20 ? `
          <p>This appears to be a direct Drive ID - checking availability...</p>
          <button onclick="tryDirectLink('${videoParam}')">Try Anyway</button>
        ` : ''}
      </div>
    `;
  }
}

function tryDirectLink(driveId) {
  displayVideo(driveId);
}
