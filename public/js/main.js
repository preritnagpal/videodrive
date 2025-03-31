document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded!');
  
    const adGate = document.getElementById('adGate');
    const adClickBtn = document.getElementById('adClickBtn');
    const adLink = document.getElementById('adLink');
    const ageGate = document.getElementById('ageGate');
    const verifyBtn = document.getElementById('verifyBtn');
    const denyBtn = document.getElementById('denyBtn');
    const videoContainer = document.getElementById('videoContainer');
  
    // 🎯 Show the ad gate on page load
    adGate.style.display = 'flex';
    ageGate.style.display = 'none'; // Ensure the age gate is hidden initially
  
    // Detect click on the ad link
    adLink.addEventListener('click', () => {
      console.log('✅ Ad clicked');
      adClickBtn.style.display = 'block'; // Reveal the button after ad is clicked
    });
  
    // ✅ Handle "I have clicked the ad" button click
    adClickBtn.addEventListener('click', () => {
      console.log('✅ Ad verified');
      adGate.style.display = 'none'; // Hide ad gate
      ageGate.style.display = 'flex'; // Show age gate
    });
  
    // ✅ Handle "Yes, I'm 18+" button click
    verifyBtn.addEventListener('click', () => {
      console.log('✅ Age Verified');
      ageGate.style.display = 'none'; // Hide age gate after verification
      loadVideo(); // Load the video
    });
  
    // ❌ Handle "No, I'm under 18" button click
    denyBtn.addEventListener('click', () => {
      alert('❌ Access denied. You must be 18+ to view this content.');
      window.location.href = 'https://www.google.com'; // Redirect to a safe site
    });
  
    // 🎥 Load video after verification
    async function loadVideo() {
      const urlParams = new URLSearchParams(window.location.search);
      const videoNumber = urlParams.get('video');
      const container = document.getElementById('videoContainer');
  
      if (!videoNumber) {
        container.innerHTML = '<div class="error">❌ Please specify a video (e.g. ?video=1)</div>';
        return;
      }
  
      try {
        // 🔥 Fetch video metadata
        const response = await fetch(`/get-video/${videoNumber}`);
        if (!response.ok) throw new Error('❌ Could not fetch video info');
  
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '❌ Video not found');
  
        // 🎥 Display the Google Drive video
        container.innerHTML = `
          <iframe class="video-player"
            src="https://drive.google.com/file/d/${result.videoId}/preview?vq=hd1080"
            frameborder="0"
            allow="autoplay; encrypted-media"
            allowfullscreen>
          </iframe>
        `;
      } catch (error) {
        container.innerHTML = `
          <div class="error">
            <p>❌ Error loading video. The video may be removed or unavailable.</p>
          </div>
        `;
      }
    }
  });
  
