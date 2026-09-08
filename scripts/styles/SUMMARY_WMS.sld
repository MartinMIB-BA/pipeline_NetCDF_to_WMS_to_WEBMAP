<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld
    http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>SUMMARY_WMS</Name>
    <UserStyle>
      <Title>Summary Exceedance (plasma_r, 0-9)</Title>
      <Abstract>Categorical exceedance summary style using plasma_r colormap. Values 0 (no exceedance) to 9 (extreme).</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <ChannelSelection>
              <GrayChannel>
                <SourceChannelName>1</SourceChannelName>
              </GrayChannel>
            </ChannelSelection>
            <ColorMap type="values">
              <!-- plasma_r colormap: high values = dark purple, low values = yellow -->
              <!-- 0 = no exceedance (transparent/very light) -->
              <ColorMapEntry color="#f0f921" quantity="0" label="0 - No exceedance" opacity="0.0"/>
              <!-- 1-3: low severity (yellow to orange) -->
              <ColorMapEntry color="#fcce25" quantity="1" label="1 - RP10 >30-50%" opacity="1.0"/>
              <ColorMapEntry color="#f89540" quantity="2" label="2 - RP10 >50-75%" opacity="1.0"/>
              <ColorMapEntry color="#eb6a28" quantity="3" label="3 - RP10 >75%" opacity="1.0"/>
              <!-- 4-6: medium severity (orange to magenta) -->
              <ColorMapEntry color="#cc4778" quantity="4" label="4 - RP100 >30-50%" opacity="1.0"/>
              <ColorMapEntry color="#a82296" quantity="5" label="5 - RP100 >50-75%" opacity="1.0"/>
              <ColorMapEntry color="#7e03a8" quantity="6" label="6 - RP100 >75%" opacity="1.0"/>
              <!-- 7-9: high severity (purple to dark) -->
              <ColorMapEntry color="#57039b" quantity="7" label="7 - RP500 >30-50%" opacity="1.0"/>
              <ColorMapEntry color="#300f7d" quantity="8" label="8 - RP500 >50-75%" opacity="1.0"/>
              <ColorMapEntry color="#0d0887" quantity="9" label="9 - RP500 >75%" opacity="1.0"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
