const h1Element = document.createElement('h1');
h1Element.textContent = 'First Party Local Script';
document.body.appendChild(h1Element);

var xhttp = new XMLHttpRequest();
xhttp.onreadystatechange = function() {
   if (this.readyState == 4 && this.status == 200) {
      // Typical action to be performed when the document is ready:
    	const hp = document.createElement('p');
		hp.textContent = xhttp.responseText;
		document.body.appendChild(hp);
	}
};
xhttp.open("GET", "https://stephenheaps.github.io/local-frames/ad.txt", true);
xhttp.send();