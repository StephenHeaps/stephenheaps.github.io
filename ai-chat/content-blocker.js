const contentBlockerDiv = document.getElementById('content-blocker');
const h3Element = document.createElement('h1');
h3Element.textContent = 'This should be blocked by the content blocker.';
contentBlockerDiv.appendChild(h3Element);