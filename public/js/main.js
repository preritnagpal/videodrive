document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded!');

  const adGate = document.getElementById('adGate');
  const adClickBtn = document.getElementById('adClickBtn');
  const ageGate = document.getElementById('ageGate');
  const verifyBtn = document.getElementById('verifyBtn');
  const denyBtn = document.getElementById('denyBtn');
  const videoContainer = document.getElementById('videoContainer');

  // Show the ad gate on page load
  adGate.style.display = 'flex';
  ageGate.style.display = 'none';

  // Modified ad click detection for TrafficStars
  let adClicked = false;
  
  document.querySelector('.ts-ad-container').addEventListener('click', () => {
    if (!adClicked) {
      console.log('✅ Ad clicked (container click)');
      adClicked = true;
      adClickBtn.style.display = 'block';
    }
  });
  
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.hidden && !adClicked) {
        console.log('✅ Ad clicked (window blur)');
        adClicked = true;
        adClickBtn.style.display = 'block';
      }
    }, 500);
  });

  adClickBtn.addEventListener('click', () => {
    console.log('✅ Ad verified');
    adGate.style.display = 'none';
    ageGate.style.display = 'flex';
  });

  verifyBtn.addEventListener('click', () => {
    console.log('✅ Age Verified');
    ageGate.style.display = 'none';
    loadVideo();
  });

  denyBtn.addEventListener('click', () => {
    alert('❌ Access denied. You must be 18+ to view this content.');
    window.location.href = 'https://www.google.com';
  });

  // Updated loadVideo function with backward compatibility
  async function loadVideo() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoNumber = urlParams.get('video');
    const container = document.getElementById('videoContainer');

    if (!videoNumber) {
      container.innerHTML = '<div class="error">❌ Please specify a video (e.g. ?video=1)</div>';
      return;
    }

    try {
      // First try the new API endpoint
      const response = await fetch(`/get-video/${videoNumber}`);
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          return displayVideo(result.videoId);
        }
      }

      // If new endpoint fails, try old format (direct Google Drive ID)
      if (/^[a-zA-Z0-9_-]{28,}$/.test(videoNumber)) {
        return displayVideo(videoNumber);
      }

      throw new Error('Video not found');

    } catch (error) {
      container.innerHTML = `
        <div class="error">
          <p>❌ Error loading video. The video may be removed or unavailable.</p>
          <p>${error.message}</p>
        </div>
      `;
      console.error('Video load error:', error);
    }
  }

  // Helper function to display video
  function displayVideo(videoId) {
    videoContainer.innerHTML = `
      <iframe class="video-player"
        src="https://drive.google.com/file/d/${videoId}/preview?vq=hd1080"
        frameborder="0"
        allow="autoplay; encrypted-media"
        allowfullscreen>
      </iframe>
    `;
  }
});
