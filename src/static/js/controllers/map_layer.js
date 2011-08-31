
function is_color(col1, col2) {
    return col1[0] == col2[0] &&
            col1[1] == col2[1] &&
            col1[2] == col2[2];
}

var NDFILayer = Backbone.View.extend({

    //DEFORESTATION_COLOR: [248, 8, 8],
    //DEGRADATION_COLOR: [247, 119, 87],
    DEFORESTATION_COLOR: [255, 46, 0],
    DEGRADATION_COLOR: [255, 199, 44],
    FOREST_COLOR: [32, 224, 32],
    NDFI_ENCODING_LIMIT: 200,

    initialize: function() {
        _.bindAll(this, 'canvas_setup', 'filter', 'apply_filter', 'map_auth', 'click', 'class_visibility');
        var self = this;
        this.editing_state = false;
        this.mapview = this.options.mapview;
        this.report = this.options.report;
        this.layer = new CanvasTileLayer(this.canvas_setup, this.filter);
        this.low = 40;
        this.high = 60;
        this.showing = false;
        this.inner_poly_sensibility = 10;

        this.ndfimap = new NDFIMap({report_id: this.report.id});
        this.ndfimap.bind('change', this.map_auth);
        this.mapview.bind('click', this.click);
        this.ndfimap.fetch({
            error: function() {
                self.trigger('map_error');
            }
        });
        this.map_layer = new LayerModel({
              id: 'NDFI',
              type: 'custom',
              description: 'NDFI analysis',
              layer: this.layer
        });
        this.sub_map_layer = [];
        this.add_class_control_layers();
        console.log(" === NDFI layer created === ");
    },

    add_class_control_layers: function() {
        var self = this;
        var classes = ['deforestation', 'degradation', 'forest', 'deforested'];
        _.each(classes, function(name) {
            var var_name = 'show_' + name;
            self[var_name] = 255;
        });
    },

    map_auth: function() {
        var self = this;
        this.token = this.ndfimap.get('token');
        this.mapid = this.ndfimap.get('mapid');
        this.mapview.layers.add(this.map_layer);
        /*_.each(this.sub_map_layer, function(l) {
            l.bind('change', self.class_visibility);
            self.mapview.layers.add(l);
        });*/
        // reload tiles
        if(this.showing) {
            this.hide();
            this.show();
        }
    },

    class_visibility: function(layer_id, enabled) {
        this['show_' + layer_id] = enabled?255:0;
        this.refrest();
    },

    refrest: function() {
        if(this.showing) {
            this.apply_filter(this.low, this.high);
        }
    },

    click: function(e) {
        var self = this;
        if(!this.editing_state) {
            return;
        }
        window.loading_small.loading('ndfilayer: click');

        var c = this.layer.composed(this.mapview.el[0]);
        var point = this.mapview.projector.transformCoordinates(e.latLng);

        // rendef offscreen
        var ctx = c.getContext('2d');
        var image_data = ctx.getImageData(0, 0, c.width, c.height);


        // get pixel color
        var pixel_pos = (point.y*c.width + point.x) * 4;
        var color = [];
        color[0] = image_data.data[pixel_pos + 0];
        color[1] = image_data.data[pixel_pos + 1];
        color[2] = image_data.data[pixel_pos + 2];
        color[3] = image_data.data[pixel_pos + 3];
        var def = is_color(color, this.DEFORESTATION_COLOR);
        var deg = is_color(color, this.DEGRADATION_COLOR);
        if(!deg && !def) {
            window.loading_small.finished('ndfilayer: click');
            return;
        }


        var poly = contour(image_data.data, c.width, c.height, point.x, point.y);

        var inners = inner_polygons(image_data.data,
                 c.width, c.height, poly, color);

        // discard small polys
        inners = _.select(inners, function(p){ return p.length > self.inner_poly_sensibility; });

        var newpoly = this.create_poly(poly, inners);
        window.loading_small.finished('ndfilayer: click');

        var type = Polygon.prototype.DEGRADATION;
        if(def) {
            type = Polygon.prototype.DEFORESTATION;
        }
        this.trigger('polygon', {paths: newpoly, type: type});

        delete image_data;
        delete c;
    },

    create_poly: function(points, inners) {
            var self = this;
            var paths = [];

            function simplify(points) {
                return GDouglasPeucker(points, 30);
            }
            // pixel -> latlon
            function unproject(p) {
                var ll = self.mapview.projector.untransformCoordinates(
                    new google.maps.Point(p[0], p[1])
                );
                return [ll.lat(), ll.lng()];
            }
            console.log("points before ", points.length);
            // outer path
            var simple = simplify(_.map(points, unproject));
            paths.push(simple);
            console.log("points after", simple.length);

            // inner paths (reversed)
            _.each(inners, function(p) {
                paths.push(simplify(_.map(p.reverse(), unproject)));
            });

            return paths;
            //inners && console.log(inners.length);

            /*
            var poly = new google.maps.Polygon({
                paths: paths,
                strokeWeight: 1
            })
            poly.setMap(App.map);
            return poly;
            */

    },

    show: function() {
        this.showing = true;
        if(this.token) {
            if(this.map_layer.collection) {
            }
            this.map_layer.set_enabled(true);
            //this.mapview.map.overlayMapTypes.insertAt(0, this.layer);
            console.log("showing NDFI");
        }
    },

    hide: function() {
        this.showing = false;
        this.map_layer.set_enabled(false);
    },

    apply_filter: function(low, high) {
        this.low = low;
        this.high = high;
        this.layer.filter_tiles(low, high);
    },

    canvas_setup: function (canvas, coord, zoom) {
      var EARTH_ENGINE_TILE_SERVER = 'http://earthengine.googleapis.com/map/';
      var self = this;
      if (zoom < 12) {
        //return;
      }
      function load_finished() {
        window.loading_small.finished("canvas_setup:");
      }
      window.loading_small.loading("canvas_setup:");// " + image.src);
      // sometimes due to browser limitation to get images from the same domain
      // images are not loaded, so start a timeout to finished the loading
      setTimeout(load_finished, 20*1000);
      var image = new Image();

      //check if thereis support for corssOrigin images and use proxy if isn't available
      if(image.crossOrigin !== undefined) {
          image.crossOrigin = '';
          image.src = EARTH_ENGINE_TILE_SERVER + this.mapid + "/"+ zoom + "/"+ coord.x + "/" + coord.y +"?token=" + this.token;
      } else {
        image.src = "/ee/tiles/" + this.mapid + "/"+ zoom + "/"+ coord.x + "/" + coord.y +"?token=" + this.token;
      }

      var ctx = canvas.getContext('2d');
      canvas.image = image;
      canvas.coord = coord;
      $(image).load(function() {
            load_finished();
            //ctx.globalAlpha = 0.5;
            ctx.drawImage(image, 0, 0);
            canvas.image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            self.layer.filter_tile(canvas, [self.low, self.high]);
      }).error(function() {
            console.log("server error loading image");
            load_finished();
      });
    },

    // filter image canvas based on thresholds
    // and color it
    filter: function(image_data, w, h, low, high) {
        var components = 4; //rgba

        // yes, this variables are the same as declared on this view
        // this is because javascript looks like optimize if
        // variables are local and a constant
        var NDFI_ENCODING_LIMIT = this.NDFI_ENCODING_LIMIT;
        //var DEFORESTATION_COLOR= [248, 8, 8];
        var DEFORESTATION_COLOR= [255, 46, 0];
        var DEGRADATION_COLOR= [255, 199, 44];
        //var DEGRADATION_COLOR= [247, 119, 87];
        var FOREST_COLOR= [32, 224, 32];

        var show_deforestation = this.show_deforestation;
        var show_degradation = this.show_degradation;
        var show_forest = this.show_forest;
        var show_deforested = this.show_deforested;

        var pixel_pos;
        for(var i=0; i < w; ++i) {
            for(var j=0; j < h; ++j) {
                pixel_pos = (j*w + i) * components;
                var p = image_data[pixel_pos];
                var a = image_data[pixel_pos + 3];
                // there is a better way to do this but this is fastest
                if(a > 0) {
                    if(p < low) {
                        image_data[pixel_pos + 0] = FOREST_COLOR[0];
                        image_data[pixel_pos + 1] = FOREST_COLOR[1];
                        image_data[pixel_pos + 2] = FOREST_COLOR[2];
                        image_data[pixel_pos + 3] = show_forest;
                    } else if(p > high) {
                        image_data[pixel_pos + 0] = DEFORESTATION_COLOR[0];
                        image_data[pixel_pos + 1] = DEFORESTATION_COLOR[1];
                        image_data[pixel_pos + 2] = DEFORESTATION_COLOR[2];
                        image_data[pixel_pos + 3] = show_deforestation;
                    } else {
                        image_data[pixel_pos + 0] = DEGRADATION_COLOR[0];
                        image_data[pixel_pos + 1] = DEGRADATION_COLOR[1];
                        image_data[pixel_pos + 2] = DEGRADATION_COLOR[2];
                        image_data[pixel_pos + 3] = show_degradation;
                    }

                    if(p > NDFI_ENCODING_LIMIT) {
                        if (p == 205) { //CLOUD
                            image_data[pixel_pos + 0] = 255;
                            image_data[pixel_pos + 1] = 255;
                            image_data[pixel_pos + 2] = 255;
                            image_data[pixel_pos + 3] = 255;
                        } else {
                            image_data[pixel_pos + 0] = 0;
                            image_data[pixel_pos + 1] = 0;
                            image_data[pixel_pos + 2] = 0;
                            image_data[pixel_pos + 3] = show_deforested;
                        }
                    } else {
                        //image_data[pixel_pos + 3] = 255;
                    }
                }
            }
        }
    }

});
